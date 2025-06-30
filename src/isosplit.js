#!/usr/bin/env node

/**
 * Isosplit module for anomaly detection and data splitting.
 *
 * This module:
 * 1. Loads data from data_stitched.csv.
 * 2. Identifies numerical columns using column_mapping.json.
 * 3. Runs an Isolation Forest to detect and remove outliers.
 * 4. Splits the cleaned data into training, validation, and test sets.
 * 5. Saves the output as train.csv, validate.csv, and test.csv.
 */

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import csv from 'csv-parser';
import { createObjectCsvWriter } from 'csv-writer';
import chalk from 'chalk';
import { IsolationForest } from 'isolation-forest';

// --- Configuration ---
const TRAIN_RATIO = 0.70;
const VALIDATE_RATIO = 0.15;
const TEST_RATIO = 0.15;
const ANOMALY_THRESHOLD = 0.7; // See isolation-forest docs for tuning

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Path and Config Loading ---
function loadConfig() {
    try {
        const possiblePaths = [
            path.join(process.cwd(), 'config.json'),
            path.join(__dirname, '..', 'config.json'),
        ];
        for (const configPath of possiblePaths) {
            if (fs.existsSync(configPath)) {
                const configContent = fs.readFileSync(configPath, 'utf-8');
                const config = JSON.parse(configContent);
                config._configPath = configPath;
                return config;
            }
        }
        throw new Error('config.json not found');
    } catch (error) {
        console.log(chalk.yellow(`⚠️  Warning: Could not load config.json: ${error.message}. Using default paths.`));
        return {};
    }
}

const config = loadConfig();

// Configure paths using working directory for outputs
const workingDir = process.cwd();
const dataDir = path.join(workingDir, config.data_dir || 'data');
const outputsDir = path.join(workingDir, config.outputs_dir || 'outputs');

// Ensure directories exist
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(outputsDir)) {
    fs.mkdirSync(outputsDir, { recursive: true });
}

const stitchedCsvPath = path.join(dataDir, config.data_stitched_file_path || 'data_stitched.csv');
const columnMappingPath = path.join(outputsDir, config.outputs_column_mapping_file || 'column_mapping.json');

// --- Helper Functions ---

/**
 * Reads a CSV file into an array of objects.
 */
async function readCsv(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }
    const results = [];
    return new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', reject);
    });
}

/**
 * Writes an array of objects to a CSV file.
 */
async function writeCsv(filePath, data) {
    if (data.length === 0) {
        console.log(chalk.yellow(`No data to write for ${path.basename(filePath)}.`));
        return;
    }
    const headers = Object.keys(data[0]).map(id => ({ id, title: id }));
    const csvWriter = createObjectCsvWriter({ path: filePath, header: headers });
    await csvWriter.writeRecords(data);
}

/**
 * Shuffles an array in place.
 * @param {Array} array The array to shuffle.
 */
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

// --- Main Logic ---

export async function main() {
    console.log(chalk.blue('🚀 Starting Isosplit process...'));

    try {
        // 1. Load data and column mapping
        console.log(`📖 Loading stitched data from: ${stitchedCsvPath}`);
        const allData = await readCsv(stitchedCsvPath);
        console.log(chalk.green(`✅ Loaded ${allData.length} rows.`));

        console.log(`📖 Loading column mapping from: ${columnMappingPath}`);
        const columnMapping = JSON.parse(fs.readFileSync(columnMappingPath, 'utf-8'));
        
        // 2. Identify numerical columns
        const numericalColumns = Object.values(columnMapping)
            .filter(col => (col.dataType === 'int' || col.dataType === 'float') && !col.isExcluded)
            .map(col => col.name);

        if (numericalColumns.length === 0) {
            console.log(chalk.red('❌ No numerical columns found in column_mapping.json. Cannot perform outlier detection.'));
            return false;
        }
        console.log(chalk.cyan(`🔍 Found ${numericalColumns.length} numerical columns for analysis: ${numericalColumns.join(', ')}`));

        // 3. Prepare data for Isolation Forest (array of objects with only numerical data)
        const numericalData = allData.map(row => {
            const record = {};
            numericalColumns.forEach(colName => {
                // Ensure value is a number, default to 0 if missing or invalid
                const val = parseFloat(row[colName]);
                record[colName] = isNaN(val) ? 0 : val;
            });
            return record;
        });

        // 4. Run Isolation Forest
        console.log('🌲 Training Isolation Forest to detect outliers...');
        const isolationForest = new IsolationForest(100, 256);
        isolationForest.fit(numericalData);
        const scores = isolationForest.scores();

        const outliers = scores
            .map((score, index) => ({ score, index }))
            .filter(item => item.score > ANOMALY_THRESHOLD);

        console.log(chalk.yellow(`🚨 Detected ${outliers.length} outliers (score > ${ANOMALY_THRESHOLD}).`));

        // --- Log outlier values ---
        if (outliers.length > 0) {
            console.log(chalk.cyan('--- Detected Outlier Details ---'));
            outliers.forEach(outlier => {
                const outlierData = numericalData[outlier.index];
                const originalRow = allData[outlier.index];
                
                // Find a unique identifier if possible (e.g., an ID column if one exists)
                const rowIdentifier = originalRow.ID || originalRow.id || `Row Index ${outlier.index}`;

                console.log(
                    chalk.red(`  [${rowIdentifier}]`),
                    chalk.white(`Score: ${outlier.score.toFixed(3)}`)
                );
                console.log(chalk.gray(`    Values: ${JSON.stringify(outlierData)}`));
            });
            console.log(chalk.cyan('--------------------------------'));
        }

        // 5. Remove outliers
        const cleanedData = allData.filter((_, index) => !outliers.some(o => o.index === index));
        console.log(chalk.green(`🧹 Removed outliers. Remaining data: ${cleanedData.length} rows.`));

        // 6. Shuffle and split data
        console.log('🔀 Shuffling and splitting data...');
        shuffleArray(cleanedData);

        const trainSize = Math.floor(cleanedData.length * TRAIN_RATIO);
        const validateSize = Math.floor(cleanedData.length * VALIDATE_RATIO);

        const trainData = cleanedData.slice(0, trainSize);
        const validateData = cleanedData.slice(trainSize, trainSize + validateSize);
        const testData = cleanedData.slice(trainSize + validateSize);
        
        console.log(`   - Training set:   ${trainData.length} rows`);
        console.log(`   - Validation set: ${validateData.length} rows`);
        console.log(`   - Test set:       ${testData.length} rows`);

        // 7. Save the split files
        const trainPath = path.join(dataDir, 'train.csv');
        const validatePath = path.join(dataDir, 'validate.csv');
        const testPath = path.join(dataDir, 'test.csv');

        console.log('💾 Saving split files...');
        await writeCsv(trainPath, trainData);
        await writeCsv(validatePath, validateData);
        await writeCsv(testPath, testData);

        console.log(chalk.green(`✅ Split files saved successfully:`));
        console.log(`   - ${trainPath}`);
        console.log(`   - ${validatePath}`);
        console.log(`   - ${testPath}`);
        
        console.log(chalk.green('\n🎉 Isosplit process completed successfully!'));
        return true;

    } catch (error) {
        console.log(chalk.red(`\n❌ An error occurred during the Isosplit process:`));
        console.log(chalk.red(error.message));
        return false;
    }
}

// CLI support
if (import.meta.url.startsWith('file:') && process.argv[1] === fileURLToPath(import.meta.url)) {
    main().then(success => {
        process.exit(success ? 0 : 1);
    });
}
