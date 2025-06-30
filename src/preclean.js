import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import csv from 'csv-parser';
import { createObjectCsvWriter } from 'csv-writer';
import { program } from 'commander';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load configuration from config.json
function loadConfig() {
    try {
        // Try multiple possible config locations
        const possiblePaths = [
            // Relative to current working directory
            path.join(process.cwd(), 'config.json'),
            // Relative to the script location
            path.join(__dirname, '..', 'config.json'),
            // In case it's in the same directory as the script
            path.join(__dirname, 'config.json')
        ];
        
        for (const configPath of possiblePaths) {
            if (fs.existsSync(configPath)) {
                const configContent = fs.readFileSync(configPath, 'utf-8');
                return JSON.parse(configContent);
            }
        }
        
        throw new Error('config.json not found in any expected location');
    } catch (error) {
        console.log(`⚠️  Warning: Could not load config.json: ${error.message}`);
        // Return default values if config.json doesn't exist
        return {
            settings__dir: "settings",
            settings_exclude_columns_file_path: "exclude_columns.txt",
            data_dir: "data",
            data_cleaned_file_path: "data_cleaned.csv",
        };
    }
}

const config = loadConfig();

/**
 * Load excluded column names from a text file
 */
function loadExcludedColumns(excludeFilePath) {
    if (!excludeFilePath || !fs.existsSync(excludeFilePath)) {
        return new Set();
    }
    
    try {
        const content = fs.readFileSync(excludeFilePath, 'utf-8');
        const excludedColumns = new Set();
        
        content.split('\n').forEach(line => {
            line = line.trim();
            // Skip empty lines and comments (lines starting with #)
            if (line && !line.startsWith('#')) {
                excludedColumns.add(line);
            }
        });
        
        console.log(`📋 Loaded ${excludedColumns.size} excluded columns from: ${excludeFilePath}`);
        if (excludedColumns.size > 0) {
            console.log(`  🚫 Excluding columns: ${Array.from(excludedColumns).sort().join(', ')}`);
        }
        return excludedColumns;
    } catch (error) {
        console.log(`⚠️  Warning: Could not load excluded columns from ${excludeFilePath}: ${error.message}`);
        return new Set();
    }
}

/**
 * Clean text by removing newlines, replacing special characters, and handling non-UTF8 chars
 */
function cleanText(text) {
    if (text === null || text === undefined || text === '') {
        return text;
    }
    
    // Convert to string if not already
    text = String(text);
    
    // Remove newlines and replace with spaces
    text = text.replace(/\n+/g, ' ');
    text = text.replace(/\r+/g, ' ');
    text = text.replace(/\t+/g, ' ');
    
    // Remove multiple spaces
    text = text.replace(/\s+/g, ' ');
    
    // Strip leading/trailing whitespace
    text = text.trim();
    
    // Handle special characters by replacing them with closest ASCII equivalents
    const replacements = {
        // Quotes and apostrophes - expanded list
        '\u2018': "'",  // left single quotation mark
        '\u2019': "'",  // right single quotation mark
        '\u201C': '"',  // left double quotation mark
        '\u201D': '"',  // right double quotation mark
        '′': "'",  // prime
        '‵': "'",  // reversed prime
        '`': "'",  // grave accent
        '″': '"',  // double prime
        '‶': '"',  // reversed double prime
        '‴': '"',  // triple prime
        '‷': '"',  // reversed triple prime
        '‹': '<',  // single left-pointing angle quotation mark
        '›': '>',  // single right-pointing angle quotation mark
        '«': '<<',  // left-pointing double angle quotation mark
        '»': '>>',  // right-pointing double angle quotation mark
        
        // Other special characters
        '–': '-',  // en dash
        '—': '-',  // em dash
        '…': '...',  // ellipsis
        '°': ' degrees',  // degree symbol
        '×': 'x',  // multiplication sign
        '÷': '/',  // division sign
        '±': '+/-',  // plus-minus sign
        '≤': '<=',  // less than or equal
        '≥': '>=',  // greater than or equal
        '≠': '!=',  // not equal
        '≈': '~',  // approximately equal
        '∞': 'infinity',  // infinity
        '√': 'sqrt',  // square root
        '²': '^2',  // squared
        '³': '^3',  // cubed
        '¼': '1/4',  // fractions
        '½': '1/2',
        '¾': '3/4',
        '⅓': '1/3',
        '⅔': '2/3',
        '⅕': '1/5',
        '⅖': '2/5',
        '⅗': '3/5',
        '⅘': '4/5',
        '⅙': '1/6',
        '⅚': '5/6',
        '⅐': '1/7',
        '⅛': '1/8',
        '⅜': '3/8',
        '⅝': '5/8',
        '⅞': '7/8',
        '⅑': '1/9',
        '⅒': '1/10',
    };
    
    for (const [specialChar, replacement] of Object.entries(replacements)) {
        text = text.replace(new RegExp(specialChar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), replacement);
    }
    
    // Handle escaped quotes that might occur during CSV processing
    // Replace multiple consecutive quotes with single quotes
    text = text.replace(/"{2,}/g, '"');  // Multiple quotes become single quote
    text = text.replace(/'{2,}/g, "'");  // Multiple apostrophes become single apostrophe
    
    // Remove any remaining non-ASCII characters that might cause issues
    // Keep only printable ASCII characters and common punctuation
    text = text.replace(/[^\x20-\x7E]/g, '');
    
    return text;
}

/**
 * Read CSV file and return array of objects
 */
function readCSV(filePath) {
    return new Promise((resolve, reject) => {
        const results = [];
        let headers = null;
        
        fs.createReadStream(filePath)
            .pipe(csv({ skipEmptyLines: true }))
            .on('headers', (headerList) => {
                headers = headerList;
            })
            .on('data', (data) => {
                results.push(data);
            })
            .on('end', () => {
                resolve({ data: results, headers });
            })
            .on('error', (error) => {
                reject(error);
            });
    });
}

/**
 * Write CSV file from array of objects
 */
async function writeCSV(filePath, data, headers) {
    const csvWriter = createObjectCsvWriter({
        path: filePath,
        header: headers.map(h => ({ id: h, title: h }))
    });
    
    await csvWriter.writeRecords(data);
}

/**
 * Clean the CSV file by applying text cleaning to all string columns
 */
async function cleanCSV(inputPath, outputPath = null, excludeFilePath = null) {
    console.log(`🔧 Starting to clean CSV file: ${inputPath}`);
    
    // Load excluded columns
    const excludedColumns = loadExcludedColumns(excludeFilePath);
    
    try {
        // Read the CSV file
        const { data, headers } = await readCSV(inputPath);
        console.log(`📊 Loaded CSV with ${data.length} rows and ${headers.length} columns`);
        
        // Clean column names using the same cleaning function
        const originalHeaders = [...headers];
        const cleanedHeaders = headers.map(cleanText);
        console.log(`  ✅ Cleaned ${cleanedHeaders.length} column headers`);
        
        // Check if any excluded columns exist in the dataset and remove them
        const existingExcluded = new Set(
            cleanedHeaders.filter(header => excludedColumns.has(header))
        );
        
        let finalHeaders = cleanedHeaders;
        let finalData = data;
        
        if (existingExcluded.size > 0) {
            console.log(`  🚫 Found ${existingExcluded.size} excluded columns in dataset: ${Array.from(existingExcluded).sort().join(', ')}`);
            console.log(`  🗑️  Removing excluded columns from output...`);
            
            // Filter out excluded columns
            finalHeaders = cleanedHeaders.filter(header => !existingExcluded.has(header));
            
            // Remove excluded columns from data
            finalData = data.map(row => {
                const newRow = {};
                finalHeaders.forEach((header, index) => {
                    const originalHeader = originalHeaders[cleanedHeaders.indexOf(header)];
                    newRow[header] = row[originalHeader];
                });
                return newRow;
            });
            
            console.log(`  ✅ Removed ${existingExcluded.size} excluded columns`);
        } else {
            // Just rename columns if no exclusions
            finalData = data.map(row => {
                const newRow = {};
                finalHeaders.forEach((header, index) => {
                    newRow[header] = row[originalHeaders[index]];
                });
                return newRow;
            });
        }
        
        // Clean all remaining string columns
        let cleanedCount = 0;
        finalHeaders.forEach(column => {
            let changed = 0;
            finalData.forEach(row => {
                const originalValue = row[column];
                const cleanedValue = cleanText(originalValue);
                if (originalValue !== cleanedValue) {
                    row[column] = cleanedValue;
                    changed++;
                }
            });
            
            if (changed > 0) {
                console.log(`  ✅ Cleaned column '${column}': ${changed} values modified`);
                cleanedCount += changed;
            }
        });
        
        // Always create a separate cleaned file, never modify the original
        if (outputPath === null) {
            const inputFile = path.parse(inputPath);
            outputPath = path.join(inputFile.dir, `${inputFile.name}_cleaned${inputFile.ext}`);
        }
        
        // Ensure we're not overwriting the original file
        if (path.resolve(outputPath) === path.resolve(inputPath)) {
            throw new Error("Cannot overwrite original file. Please specify a different output path.");
        }
        
        // Save the cleaned CSV to the new location
        await writeCSV(outputPath, finalData, finalHeaders);
        console.log(`💾 Saved cleaned CSV to: ${outputPath}`);
        console.log(`📊 Final CSV contains ${finalHeaders.length} columns and ${finalData.length} rows`);
        console.log(`🎯 Total values cleaned: ${cleanedCount}`);
        if (existingExcluded.size > 0) {
            console.log(`🗑️  Total columns removed: ${existingExcluded.size}`);
        }
        console.log(`🛡️  Original file preserved: ${inputPath}`);
        
        return outputPath;
        
    } catch (error) {
        console.log(`❌ Error cleaning CSV: ${error.message}`);
        return null;
    }
}

/**
 * Main function to handle command line arguments and execute cleaning
 */
async function main() {
    program
        .name('preclean')
        .description('Clean CSV data by removing newlines, replacing special characters, and handling non-UTF8 chars.')
        .version('1.0.0');

    program
        .option('--input <path>', 'Input CSV file path (default: data/data.csv)')
        .option('--output <path>', 'Output CSV file path (default: data/data_cleaned.csv)')
        .option('--exclude <path>', 'Path to text file containing column names to exclude from cleaning (default: settings/exclude_columns.txt)');

    program.parse();
    const options = program.opts();

    // Define paths using config
    const dataDir = config.data_dir || 'data';
    const originalCsvPath = options.input || path.join(dataDir, 'data.csv');
    const cleanedCsvPath = options.output || path.join(dataDir, config.data_cleaned_file_path || 'data_cleaned.csv');
    const excludeFilePath = options.exclude || path.join(config.settings__dir || 'settings', config.settings_exclude_columns_file_path || 'exclude_columns.txt');

    // Check if input file exists
    if (!fs.existsSync(originalCsvPath)) {
        console.log(`❌ Input CSV file not found: ${originalCsvPath}`);
        console.log("Please ensure the data.csv file exists in the data/ directory.");
        return false;
    }

    console.log(`🛡️  Original file will be preserved: ${originalCsvPath}`);
    console.log(`📝 Cleaned file will be created: ${cleanedCsvPath}`);
    if (fs.existsSync(excludeFilePath)) {
        console.log(`📋 Using exclude file: ${excludeFilePath}`);
    } else {
        console.log(`📋 No exclude file found at: ${excludeFilePath} (will clean all columns)`);
    }

    // Clean the CSV and save to separate file
    const cleanedPath = await cleanCSV(originalCsvPath, cleanedCsvPath, excludeFilePath);

    if (cleanedPath) {
        console.log(`\n✅ Successfully cleaned CSV data!`);
        console.log(`📁 Original file (unchanged): ${originalCsvPath}`);
        console.log(`📁 Cleaned file (new): ${cleanedPath}`);
        console.log("\n🔄 You can now run architect.js with the cleaned data.");
        return true;
    } else {
        console.log("❌ Failed to clean CSV data.");
        return false;
    }
}

// Export functions for use in other modules
export {
    loadExcludedColumns,
    cleanText,
    cleanCSV,
    readCSV,
    writeCSV
};

// Run main function if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}
