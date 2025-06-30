import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import csv from 'csv-parser';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// API Configuration
const DBCLEAN_API_URL = process.env.DBCLEAN_API_URL || 'https://dbclean-api.dbcleandev.workers.dev';

// Token limits for batching
const TOKEN_LIMIT = 500000; // 500k tokens

// Load configuration from config.json (same logic as architect.js)
function loadConfig() {
    try {
        const possiblePaths = [
            path.join(process.cwd(), 'config.json'),
            path.join(__dirname, '..', 'config.json'),
            path.join(__dirname, 'config.json')
        ];
        
        for (const configPath of possiblePaths) {
            if (fs.existsSync(configPath)) {
                const configContent = fs.readFileSync(configPath, 'utf-8');
                const config = JSON.parse(configContent);
                config._configPath = configPath;
                return config;
            }
        }
        
        throw new Error('config.json not found in any expected location');
    } catch (error) {
        console.log(chalk.yellow(`⚠️  Warning: Could not load config.json: ${error.message}`));
        return {
            data_dir: "data",
            data_cleaned_file_path: "data_cleaned.csv",
            data_deduped_file_path: "data_deduped.csv",
            settings__dir: "settings",
            outputs_dir: "outputs",
            outputs_architect_output_file: "architect_output.txt",
            outputs_column_mapping_file: "column_mapping.json",
            outputs_cleaned_columns_dir: "cleaned_columns"
        };
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

/**
 * Extract schema_design section from architect output
 */
function extractSchemaDesign(architectOutput) {
    const schemaMatch = architectOutput.match(/<schema_design>(.*?)<\/schema_design>/s);
    return schemaMatch ? schemaMatch[1].trim() : '';
}

/**
 * Extract specific column schema from the full schema design
 */
function extractColumnSchema(fullSchemaDesign, columnName) {
    const lines = fullSchemaDesign.split('\n');
    
    let headerLine = null;
    let columnLine = null;
    
    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;
        
        // Check if this is the header line
        if (trimmedLine === 'data_title,data_type,data_description,data_example,data_regex') {
            headerLine = trimmedLine;
            continue;
        }
        
        // Skip EXCLUDE lines but still check for our column
        const cleanLine = trimmedLine.replace('```EXCLUDE```', '');
        
        // Check if this line starts with our column name
        if (cleanLine.startsWith(`${columnName},`)) {
            columnLine = cleanLine;
            break;
        }
    }
    
    if (headerLine && columnLine) {
        return `${headerLine}\n${columnLine}`;
    } else {
        console.log(chalk.yellow(`⚠️  Could not find schema for column '${columnName}', using full schema`));
        return fullSchemaDesign;
    }
}

/**
 * Extract only the specific column data from semantic_diff
 */
function extractScopedSemanticDiff(semanticDiff, columnName, columnIndex) {
    try {
        const lines = semanticDiff.split('\n');
        const scopedLines = [];
        
        // Create header with ID and the specific column
        scopedLines.push(`ID,${columnName}`);
        
        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;
            
            // Skip lines that indicate existing data
            if (trimmedLine.includes('… Existing Data …') || trimmedLine.includes('... Existing Data ...')) {
                continue;
            }
            
            // Skip flagged lines for now
            if (trimmedLine.startsWith('```FLAGGED')) {
                continue;
            }
            
            // Parse CSV line to extract specific column
            try {
                // Simple CSV parsing for this specific case
                const columns = parseCsvLine(trimmedLine);
                
                if (columns.length > columnIndex) {
                    const rowId = columns[0]; // First column is always ID
                    const columnValue = columns[columnIndex] || '';
                    
                    scopedLines.push(`${rowId},${columnValue}`);
                }
            } catch (e) {
                console.log(chalk.yellow(`⚠️  Could not parse semantic_diff line: ${trimmedLine.substring(0, 50)}...`));
                continue;
            }
        }
        
        return scopedLines.join('\n');
        
    } catch (error) {
        console.log(chalk.yellow(`⚠️  Error extracting scoped semantic_diff: ${error.message}`));
        return '';
    }
}

/**
 * Simple CSV line parser (handles basic cases)
 */
function parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++; // Skip next quote
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    
    result.push(current); // Add last field
    return result;
}

/**
 * Extract semantic_diff section from cleaner output
 */
function extractSemanticDiff(cleanerOutput) {
    const diffMatch = cleanerOutput.match(/<semantic_diff>(.*?)<\/semantic_diff>/s);
    return diffMatch ? diffMatch[1].trim() : '';
}

/**
 * Count tokens (rough estimation based on characters)
 */
function countTokens(text) {
    // Rough estimation: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
}

/**
 * Split array into batches
 */
function splitIntoBatches(data, numBatches) {
    const totalRows = data.length;
    const rowsPerBatch = Math.ceil(totalRows / numBatches);
    
    const batches = [];
    for (let i = 0; i < numBatches; i++) {
        const startIdx = i * rowsPerBatch;
        const endIdx = Math.min((i + 1) * rowsPerBatch, totalRows);
        if (startIdx < totalRows) {
            const batch = data.slice(startIdx, endIdx);
            batches.push(batch);
        }
    }
    
    return batches;
}

/**
 * Read CSV file and return as array of objects
 */
async function readCsvFile(filePath) {
    return new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', reject);
    });
}

/**
 * Convert array of objects to CSV string
 */
function arrayToCsv(data) {
    if (data.length === 0) return '';
    
    const headers = Object.keys(data[0]);
    const csvLines = [headers.join(',')];
    
    for (const row of data) {
        const values = headers.map(header => {
            let value = row[header] || '';
            // Escape quotes and wrap in quotes if contains comma or quote
            if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
                value = '"' + value.replace(/"/g, '""') + '"';
            }
            return value;
        });
        csvLines.push(values.join(','));
    }
    
    return csvLines.join('\n');
}

/**
 * Make API request to dbclean-api for column processing
 */
async function callCleanerApi(columnData, columnSchema, scopedSemanticDiff, model = null, email, apiKey) {
    try {
        const response = await axios.post(`${DBCLEAN_API_URL}/api/cleaner/process`, {
            columnData,
            columnSchema,
            scopedSemanticDiff,
            model
        }, {
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': apiKey,
                'X-Email': email
            },
            timeout: 300000 // 5 minutes timeout
        });
        
        return {
            success: true,
            result: response.data.result
        };
        
    } catch (error) {
        return {
            success: false,
            error: error.response?.data?.error || error.message
        };
    }
}

/**
 * Process a single batch of column data with retry logic
 */
async function processColumnBatch(safeFilename, batchNum, totalBatches, batchData, columnInfo, originalColumnName, columnSchema, scopedSemanticDiff, email, apiKey, model, COLUMN_OUTPUT_DIR, COLUMN_LOG_DIR) {
    try {
        const { name: columnName, index: columnIndex } = columnInfo;
        
        // Convert batch to CSV string
        const batchCsv = arrayToCsv(batchData);
        
        // Call API with retry logic
        const maxRetries = 3;
        let response;
        
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                response = await callCleanerApi(batchCsv, columnSchema, scopedSemanticDiff, model, email, apiKey);
                if (response.success) {
                    break; // Success, exit retry loop
                } else {
                    throw new Error(response.error);
                }
            } catch (error) {
                const errorMsg = error.message;
                
                // Check if this is a rate limit error
                if (errorMsg.includes('429') || errorMsg.toLowerCase().includes('quota') || errorMsg.toLowerCase().includes('rate')) {
                    if (attempt < maxRetries - 1) { // Not the last attempt
                        const waitTime = 45000; // 45 seconds
                        if (totalBatches === 1) {
                            console.log(chalk.yellow(`⏸️  Rate limit hit for column ${columnIndex}: ${columnName}`));
                        } else {
                            console.log(chalk.yellow(`⏸️  Rate limit hit for column ${columnIndex}: ${columnName} (batch ${batchNum}/${totalBatches})`));
                        }
                        console.log(chalk.yellow(`⏳ Waiting ${waitTime / 1000} seconds before retrying... (attempt ${attempt + 1}/${maxRetries})`));
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                        continue;
                    } else {
                        // Last attempt failed
                        throw error;
                    }
                } else {
                    // Not a rate limit error, re-raise immediately
                    throw error;
                }
            }
        }
        
        // Create directories
        await fsp.mkdir(COLUMN_OUTPUT_DIR, { recursive: true });
        await fsp.mkdir(COLUMN_LOG_DIR, { recursive: true });
        
        // Determine filename suffix
        let outputFilename, logFilename;
        if (totalBatches === 1) {
            outputFilename = `${safeFilename}_output.txt`;
            logFilename = `${safeFilename}_log.txt`;
        } else {
            outputFilename = `${safeFilename}_batch_${batchNum}_output.txt`;
            logFilename = `${safeFilename}_batch_${batchNum}_log.txt`;
        }
        
        // Save AI output only
        const outputPath = path.join(COLUMN_OUTPUT_DIR, outputFilename);
        await fsp.writeFile(outputPath, response.result, 'utf8');
        
        // Save complete log
        const logPath = path.join(COLUMN_LOG_DIR, logFilename);
        const logContent = [
            '=== COLUMN INFO ===',
            `Original Name: ${originalColumnName}`,
            `New Name: ${columnName}`,
            `Index: ${columnIndex}`,
            `Is Excluded: ${columnInfo.isExcluded}`,
            totalBatches > 1 ? `Batch: ${batchNum} of ${totalBatches}` : '',
            totalBatches > 1 ? `Rows in batch: ${batchData.length}` : '',
            '',
            '=== INPUT ===',
            `Schema: ${columnSchema}`,
            `Scoped Semantic Diff: ${scopedSemanticDiff}`,
            `Data: ${batchCsv}`,
            '',
            '=== AI RESPONSE ===',
            response.result
        ].filter(line => line !== '').join('\n');
        
        await fsp.writeFile(logPath, logContent, 'utf8');
        
        if (totalBatches === 1) {
            console.log(chalk.green(`✅ Completed column ${columnIndex}: ${columnName}`));
        } else {
            console.log(chalk.green(`✅ Completed column ${columnIndex}: ${columnName} (batch ${batchNum}/${totalBatches})`));
        }
        
        return {
            columnName,
            result: response.result,
            outputPath
        };
        
    } catch (error) {
        const { name: columnName = 'UNKNOWN' } = columnInfo || {};
        if (totalBatches === 1) {
            console.log(chalk.red(`❌ Error processing column ${columnName}: ${error.message}`));
        } else {
            console.log(chalk.red(`❌ Error processing column ${columnName} batch ${batchNum}: ${error.message}`));
        }
        return null;
    }
}

/**
 * Check if a value is empty/null/undefined
 */
function isEmptyValue(value) {
    return value === null || value === undefined || value === '' || 
           value === 'null' || value === 'NULL' || value === 'NaN' || 
           value === 'nan' || value === 'undefined' || 
           (typeof value === 'string' && value.trim() === '');
}

/**
 * Test if a value matches the expected regex pattern
 */
function testRegexMatch(value, regex) {
    if (!regex || regex === '^.*$') {
        return true; // No validation needed for catch-all regex
    }
    
    if (isEmptyValue(value)) {
        return true; // Empty values are considered valid (will be standardized as null)
    }
    
    try {
        const regexObj = new RegExp(regex);
        return regexObj.test(value.toString());
    } catch (error) {
        console.log(chalk.yellow(`⚠️  Invalid regex pattern '${regex}': ${error.message}`));
        return true; // If regex is invalid, consider value as valid
    }
}

/**
 * Filter and categorize column data based on regex validation
 */
function filterColumnData(csvData, originalColumnName, columnName, regex) {
    const validData = [];
    const invalidData = [];
    const dataMap = new Map(); // Map to track original values by ID
    
    for (const row of csvData) {
        const id = row.ID;
        const value = row[originalColumnName];
        
        // Store original value in map
        dataMap.set(id, value);
        
        if (isEmptyValue(value)) {
            // Empty values are valid and will be standardized as null
            validData.push({
                ID: id,
                [columnName]: ''
            });
        } else if (testRegexMatch(value, regex)) {
            // Value matches regex - keep as is
            validData.push({
                ID: id,
                [columnName]: value
            });
        } else {
            // Value doesn't match regex - needs cleaning
            invalidData.push({
                ID: id,
                [columnName]: value
            });
        }
    }
    
    return { validData, invalidData, dataMap };
}

/**
 * Process a single column with batching if needed
 */
async function processColumn(originalColumnName, columnInfo, csvData, schemaDesign, semanticDiff, email, apiKey, model, COLUMN_OUTPUT_DIR, COLUMN_LOG_DIR) {
    try {
        const { name: columnName, index: columnIndex, regex } = columnInfo;
        
        console.log(chalk.blue(`🔄 Processing column ${columnIndex}: ${columnName} ('${originalColumnName}')`));
        
        // Check if column has catch-all regex (^.*$) - skip processing
        if (regex === '^.*$') {
            console.log(chalk.yellow(`⏭️  Skipping column ${columnIndex}: ${columnName} (regex allows any value)`));
            
            return {
                columnName,
                result: 'Skipped - regex allows any value',
                outputPath: null
            };
        }
        
        // Filter data based on regex validation
        const { validData, invalidData, dataMap } = filterColumnData(csvData, originalColumnName, columnName, regex);
        
        console.log(chalk.blue(`📊 Column validation: ${validData.length} valid, ${invalidData.length} need cleaning`));
        
        // If no data needs cleaning, skip AI processing
        if (invalidData.length === 0) {
            console.log(chalk.green(`✅ Column ${columnIndex}: ${columnName} - all data already valid, no AI processing needed`));
            
            return {
                columnName,
                result: 'All data already valid',
                outputPath: null
            };
        }
        
        // Create safe filename
        const safeFilename = columnName.replace(/[^\w\s-]/g, '').trim().replace(/[-\s]+/g, '_');
        
        // Extract only the relevant column schema
        const columnSchema = extractColumnSchema(schemaDesign, columnName);
        
        // Extract scoped semantic_diff for this column (using only invalid data)
        const scopedSemanticDiff = extractScopedSemanticDiff(semanticDiff, columnName, columnIndex);
        
        // Use only invalid data for AI processing
        const columnData = invalidData;
        
        // Check if we need to split into batches
        const columnCsv = arrayToCsv(columnData);
        const baseInput = `Schema: ${columnSchema}\nSemantic Diff: ${scopedSemanticDiff}\nData: ${columnCsv}`;
        
        // Count tokens (using a placeholder for token counting since prompt is in cloud)
        const totalTokens = countTokens(baseInput) + 2000; // Add estimated prompt size
        
        if (totalTokens <= TOKEN_LIMIT) {
            // Process as single batch
            console.log(chalk.blue(`📊 Processing ${invalidData.length} invalid rows as single batch (${totalTokens.toLocaleString()} tokens)`));
            const result = await processColumnBatch(safeFilename, 1, 1, columnData, columnInfo, originalColumnName, columnSchema, scopedSemanticDiff, email, apiKey, model, COLUMN_OUTPUT_DIR, COLUMN_LOG_DIR);
            return result;
        } else {
            // Need to split into batches
            let numBatches = 2;
            let estimatedTokens = totalTokens;
            
            while (estimatedTokens > TOKEN_LIMIT) {
                // Estimate tokens per batch
                const rowsPerBatch = Math.ceil(columnData.length / numBatches);
                const sampleBatch = columnData.slice(0, rowsPerBatch);
                const sampleCsv = arrayToCsv(sampleBatch);
                const sampleInput = `Schema: ${columnSchema}\nSemantic Diff: ${scopedSemanticDiff}\nData: ${sampleCsv}`;
                
                estimatedTokens = countTokens(sampleInput) + 2000; // Add estimated prompt size
                
                if (estimatedTokens <= TOKEN_LIMIT) {
                    break;
                }
                
                numBatches++;
                if (numBatches > 20) { // Safety limit
                    console.log(chalk.yellow('⚠️  Too many batches required, using 20 batches'));
                    break;
                }
            }
            
            console.log(chalk.blue(`📊 Splitting ${invalidData.length} invalid rows into ${numBatches} batches (estimated ${estimatedTokens.toLocaleString()} tokens per batch)`));
            
            // Split data into batches
            const batches = splitIntoBatches(columnData, numBatches);
            
            // Process each batch
            const results = [];
            for (let batchNum = 0; batchNum < batches.length; batchNum++) {
                const result = await processColumnBatch(safeFilename, batchNum + 1, batches.length, batches[batchNum], columnInfo, originalColumnName, columnSchema, scopedSemanticDiff, email, apiKey, model, COLUMN_OUTPUT_DIR, COLUMN_LOG_DIR);
                if (result) { // If successful
                    results.push(result);
                }
            }
            
            return {
                columnName: `${columnName}_batched`,
                result: `Processed ${results.length} batches of ${invalidData.length} invalid rows`,
                outputPath: 'Multiple files created'
            };
        }
        
    } catch (error) {
        const { name: columnName = 'UNKNOWN' } = columnInfo || {};
        console.log(chalk.red(`❌ Error processing column ${columnName}: ${error.message}`));
        return null;
    }
}

/**
 * Main function to process CSV columns with cleaner
 */
export async function main(email = null, apiKey = null, model = null) {
    try {
        // Show configuration info
        if (config._configPath) {
            console.log(chalk.gray(`📋 Config loaded from: ${config._configPath}`));
        } else {
            console.log(chalk.yellow('📋 Using default configuration (config.json not found)'));
        }
        
        // Configuration paths
        const ARCHITECT_OUTPUT_PATH = path.join(outputsDir, config.outputs_architect_output_file || 'architect_output.txt');
        const COLUMN_MAPPING_PATH = path.join(outputsDir, config.outputs_column_mapping_file || 'column_mapping.json');
        const CLEANED_CSV_PATH = path.join(dataDir, config.data_cleaned_file_path || 'data_cleaned.csv');
        const DEDUPED_CSV_PATH = path.join(dataDir, config.data_deduped_file_path || 'data_deduped.csv');
        const COLUMN_OUTPUT_DIR = path.join(outputsDir, config.outputs_cleaned_columns_dir || 'cleaned_columns', 'outputs');
        const COLUMN_LOG_DIR = path.join(outputsDir, config.outputs_cleaned_columns_dir || 'cleaned_columns', 'logs');
        
        // Clean up previous cleaner outputs
        const cleanerColumnsDir = path.join(outputsDir, config.outputs_cleaned_columns_dir || 'cleaned_columns');
        try {
            await fsp.rm(cleanerColumnsDir, { recursive: true, force: true });
            console.log(chalk.green(`🧹 Cleaned up previous cleaner outputs`));
        } catch (error) {
            // Directory might not exist, that's okay
        }
        
        // Read architect output to get schema
        console.log(chalk.blue('📖 Reading architect output...'));
        const architectOutput = await fsp.readFile(ARCHITECT_OUTPUT_PATH, 'utf8');
        
        const schemaDesign = extractSchemaDesign(architectOutput);
        if (!schemaDesign) {
            console.log(chalk.red('❌ Could not extract schema_design from architect output'));
            return false;
        }
        
        // Extract semantic_diff from architect output as example
        const semanticDiff = extractSemanticDiff(architectOutput);
        if (!semanticDiff) {
            console.log(chalk.red('❌ Could not extract semantic_diff from architect output'));
            return false;
        }
        
        console.log(chalk.green(`✅ Extracted schema_design (${schemaDesign.length} chars)`));
        console.log(chalk.green(`✅ Extracted semantic_diff (${semanticDiff.length} chars)`));
        
        // Load column mapping
        console.log(chalk.blue('📖 Reading column mapping...'));
        const columnMappingContent = await fsp.readFile(COLUMN_MAPPING_PATH, 'utf8');
        const columnMapping = JSON.parse(columnMappingContent);
        
        console.log(chalk.green(`✅ Loaded ${Object.keys(columnMapping).length} column mappings`));
        
        // Load CSV data, preferring deduped if available
        let inputCsvFile = CLEANED_CSV_PATH;
        let inputDescription = 'data_cleaned.csv';
        
        if (fs.existsSync(DEDUPED_CSV_PATH)) {
            inputCsvFile = DEDUPED_CSV_PATH;
            inputDescription = 'data_deduped.csv';
            console.log(chalk.blue('📖 Found deduplicated data, using data_deduped.csv...'));
        } else {
            console.log(chalk.blue('📖 Loading data_cleaned.csv...'));
        }

        console.log(chalk.blue(`📊 Loading CSV data from ${inputDescription}...`));
        let csvData = await readCsvFile(inputCsvFile);
        
        // Add ID column if not present
        if (!csvData[0] || !csvData[0].ID) {
            csvData = csvData.map((row, index) => ({
                ID: (index + 1).toString(),
                ...row
            }));
        }
        
        console.log(chalk.green(`✅ Loaded ${csvData.length} rows of data`));
        
        // Process each column
        console.log(chalk.blue('\n🚀 Processing columns...'));
        
        const processedColumns = [];
        const excludedColumns = [];
        const skippedColumns = [];
        const validColumns = [];
        
        // Sort columns by index to process in order
        const sortedColumns = Object.entries(columnMapping).sort((a, b) => a[1].index - b[1].index);
        
        for (const [originalColumnName, columnInfo] of sortedColumns) {
            if (columnInfo.isExcluded) {
                excludedColumns.push(columnInfo.name);
                console.log(chalk.yellow(`⏭️  Skipping excluded column ${columnInfo.index}: ${columnInfo.name}`));
                continue;
            }
            
            const result = await processColumn(originalColumnName, columnInfo, csvData, schemaDesign, semanticDiff, email, apiKey, model, COLUMN_OUTPUT_DIR, COLUMN_LOG_DIR);
            if (result) { // If successful
                if (result.result.includes('regex allows any value')) {
                    skippedColumns.push(result.columnName);
                } else if (result.result.includes('All data already valid')) {
                    validColumns.push(result.columnName);
                } else {
                    processedColumns.push(result.columnName);
                }
                // Small delay between columns to avoid rate limits
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        console.log(chalk.green('\n🎉 Cleaner pipeline completed successfully!'));
        console.log(chalk.blue(`📁 Column outputs saved in: ${COLUMN_OUTPUT_DIR}`));
        console.log(chalk.blue(`📝 Column logs saved in: ${COLUMN_LOG_DIR}`));
        console.log(chalk.green(`✅ AI cleaned ${processedColumns.length} columns`));
        console.log(chalk.blue(`🔍 ${validColumns.length} columns already had valid data`));
        console.log(chalk.gray(`📋 ${skippedColumns.length} columns skipped (regex ^.*$)`));
        console.log(chalk.yellow(`⏭️  ${excludedColumns.length} columns excluded by configuration`));
        return true;
        
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log(chalk.red(`❌ File not found: ${error.path}`));
        } else {
            console.log(chalk.red(`❌ Error: ${error.message}`));
        }
        return false;
    }
}

// CLI support
if (import.meta.url === `file://${process.argv[1]}`) {
    main().then(success => {
        process.exit(success ? 0 : 1);
    });
}
