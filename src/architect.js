import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import csv from 'csv-parser';
import { createObjectCsvWriter } from 'csv-writer';
import axios from 'axios';
import { program } from 'commander';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// API Configuration
const API_BASE_URL = 'https://dbclean-api.dbcleandev.workers.dev';

// Load configuration from config.json
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
        console.log(`⚠️  Warning: Could not load config.json: ${error.message}`);
        return {
            data_dir: "data",
            data_cleaned_file_path: "data_cleaned.csv",
            settings__dir: "settings",
            outputs_dir: "outputs",
            outputs_architect_output_file: "architect_output.txt"
        };
    }
}

const config = loadConfig();

// Configure paths using working directory for outputs, package directory for settings
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

const CSV_PATH = path.join(dataDir, config.data_cleaned_file_path || 'data_cleaned.csv');
const ORIGINAL_CSV_PATH = path.join(dataDir, 'data.csv');
const OUTPUT_PATH = path.join(outputsDir, config.outputs_architect_output_file || 'architect_output.txt');
const LOG_PATH = path.join(outputsDir, 'architect_log.txt');
const COLUMN_MAPPING_PATH = path.join(outputsDir, 'column_mapping.json');

const DEFAULT_SAMPLE_SIZE = 5;

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
 * Get first n rows from CSV file and return as CSV string
 */
async function getFirstCSVRows(csvPath, n) {
    try {
        // Try cleaned CSV first, fall back to original if not found
        let actualPath = csvPath;
        if (!fs.existsSync(csvPath)) {
            console.log(`⚠️  Cleaned CSV not found: ${csvPath}`);
            actualPath = ORIGINAL_CSV_PATH;
            console.log(`🔄 Using original CSV: ${actualPath}`);
        }

        const { data, headers } = await readCSV(actualPath);
        
        if (n > data.length) {
            n = data.length;
        }

        // Take first n rows
        const sampleData = data.slice(0, n);
        
        // Add ID column as the first column, starting from 1
        const sampleWithId = sampleData.map((row, index) => ({
            ID: index + 1,
            ...row
        }));

        // Convert to CSV string - properly quote headers that contain commas
        const newHeaders = ['ID', ...headers];
        const quotedHeaders = newHeaders.map(header => {
            if (typeof header === 'string' && (header.includes(',') || header.includes('"') || header.includes('\n'))) {
                return '"' + header.replace(/"/g, '""') + '"';
            }
            return header;
        });
        let csvString = quotedHeaders.join(',') + '\n';
        
        sampleWithId.forEach(row => {
            const values = newHeaders.map(header => {
                let value = row[header] || '';
                // Escape quotes and wrap in quotes if necessary
                if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
                    value = '"' + value.replace(/"/g, '""') + '"';
                }
                return value;
            });
            csvString += values.join(',') + '\n';
        });

        return csvString;
    } catch (error) {
        throw new Error(`Error reading CSV: ${error.message}`);
    }
}

/**
 * Get available models from API
 */
async function getAvailableModels() {
    try {
        const response = await axios.get(`${API_BASE_URL}/api/models`);
        return response.data.models || [];
    } catch (error) {
        console.log('⚠️  Could not fetch available models:', error.message);
        return [];
    }
}

/**
 * Main function to process CSV data with AI via API
 */
async function main(sampleSize = DEFAULT_SAMPLE_SIZE, customInstructions = null, email = null, apiKey = null, model = null) {
    try {
        // Ensure output directory exists
        if (!fs.existsSync(outputsDir)) {
            fs.mkdirSync(outputsDir, { recursive: true });
        }

        // Get first rows from CSV
        const userDataCSV = await getFirstCSVRows(CSV_PATH, sampleSize);

        // Custom instructions will be applied silently

        // Prepare API request payload
        const requestPayload = {
            userData: userDataCSV,
            sampleSize: sampleSize,
            customInstructions: customInstructions || null,
            model: model || null
        };

        // Add authentication if provided
        const headers = {
            'Content-Type': 'application/json'
        };

        if (email && apiKey) {
            headers['X-Email'] = email;
            headers['X-API-Key'] = apiKey;
        }

        // Make API request to dbclean-api (silently)
        const response = await axios.post(`${API_BASE_URL}/api/architect/process`, requestPayload, {
            headers: headers,
            timeout: 300000 // 5 minute timeout
        });

        const responseData = response.data;
        const responseText = responseData.result || responseData.response || JSON.stringify(responseData);

        // Write AI response only to main output file
        fs.writeFileSync(OUTPUT_PATH, responseText, 'utf-8');

        // Write complete log to separate log file
        const logContent = [
            '=== API REQUEST ===',
            JSON.stringify(requestPayload, null, 2),
            '\n=== USER DATA ===',
            `<user_data>\n${userDataCSV}\n</user_data>`,
            '\n=== AI RESPONSE ===',
            responseText
        ].join('\n');
        
        fs.writeFileSync(LOG_PATH, logContent, 'utf-8');

        // Save results silently, let CLI handle user feedback
        
        // Create column mapping files
        await createColumnMapping(LOG_PATH);

    } catch (error) {
        if (error.response) {
            // API responded with error status
            const status = error.response.status;
            const message = error.response.data?.error || error.response.statusText;
            console.log(`❌ API Error (${status}): ${message}`);
        } else if (error.code === 'ECONNREFUSED') {
            console.log('❌ Could not connect to API service. Please check if the service is running.');
        } else if (error.code === 'ETIMEDOUT') {
            console.log('❌ Request timed out. The AI processing may take longer than expected.');
        } else if (error.message.includes('not found')) {
            console.log(`❌ File not found: ${error.message}`);
            console.log('Please ensure the CSV file exists in the correct location.');
        } else {
            console.log(`❌ Error: ${error.message}`);
        }
        throw error;
    }
}

/**
 * Create column mapping from architect log file
 */
async function createColumnMapping(logFilePath = LOG_PATH) {
    try {
        // Read the architect log file
        const content = fs.readFileSync(logFilePath, 'utf-8');

        // Extract user_data section
        const userDataMatch = content.match(/<user_data>\s*\n(.*?)\n<\/user_data>/s);
        if (!userDataMatch) {
            console.log('❌ Could not find user_data section in output file');
            return null;
        }

        const userDataContent = userDataMatch[1].trim();

        // Extract schema_design section
        const schemaDesignMatch = content.match(/<schema_design>\s*\n(.*?)\n<\/schema_design>/s);
        if (!schemaDesignMatch) {
            console.log('❌ Could not find schema_design section in output file');
            return null;
        }

        const schemaDesignContent = schemaDesignMatch[1].trim();

        // Parse original column names from user_data (skip ID column)
        const userDataLines = userDataContent.split('\n');
        if (userDataLines.length < 1) {
            console.log('❌ No data found in user_data section');
            return null;
        }

        // Get header line (first line of CSV)
        const headerLine = userDataLines[0];
        
        // Parse CSV header properly
        const originalColumns = parseCSVLine(headerLine);
        
        // Remove ID column (first column)
        if (originalColumns[0] === 'ID') {
            originalColumns.shift();
        }

        // Parse column information from schema_design
        const schemaLines = schemaDesignContent.split('\n');
        
        const newColumns = [];
        const excludedColumns = [];
        const uniqueColumns = [];

        for (const line of schemaLines) {
            const trimmedLine = line.trim();
            if (trimmedLine && trimmedLine !== 'data_title,data_type,data_description,data_example,data_regex') {
                try {
                    // Handle EXCLUDE columns
                    if (trimmedLine.startsWith('```EXCLUDE```')) {
                        const csvLine = trimmedLine.replace('```EXCLUDE```', '');
                        const columnInfo = parseSchemaLine(csvLine);
                        if (columnInfo) {
                            newColumns.push(columnInfo);
                            excludedColumns.push(columnInfo.name);
                        }
                    }
                    // Handle UNIQUE columns
                    else if (trimmedLine.startsWith('```UNIQUE```')) {
                        const csvLine = trimmedLine.replace('```UNIQUE```', '');
                        const columnInfo = parseSchemaLine(csvLine);
                        if (columnInfo) {
                            newColumns.push(columnInfo);
                            uniqueColumns.push(columnInfo.name);
                        }
                    }
                    // Handle regular columns
                    else {
                        const columnInfo = parseSchemaLine(trimmedLine);
                        if (columnInfo) {
                            newColumns.push(columnInfo);
                        }
                    }
                } catch (error) {
                    const preview = trimmedLine.length > 50 ? trimmedLine.substring(0, 50) + '...' : trimmedLine;
                    console.log(`⚠️  Could not parse schema line: ${preview} (Error: ${error.message})`);
                    continue;
                }
            }
        }

        // Create mapping dictionary with exclusion flags and regex
        const columnMapping = {};

        // Map columns by position (assuming they correspond in order)
        const minLength = Math.min(originalColumns.length, newColumns.length);

        for (let i = 0; i < minLength; i++) {
            const originalCol = originalColumns[i];
            const newColInfo = newColumns[i];
            const isExcluded = excludedColumns.includes(newColInfo.name);
            const isUnique = uniqueColumns.includes(newColInfo.name);

            columnMapping[originalCol] = {
                name: newColInfo.name,
                isExcluded: isExcluded,
                unique: isUnique,
                index: i + 1, // 1-based indexing
                dataType: newColInfo.dataType,
                description: newColInfo.description,
                example: newColInfo.example,
                regex: newColInfo.regex
            };
        }

        // Handle any remaining columns
        if (originalColumns.length > newColumns.length) {
            for (let i = newColumns.length; i < originalColumns.length; i++) {
                const unmappedName = `UNMAPPED_${i}`;
                columnMapping[originalColumns[i]] = {
                    name: unmappedName,
                    isExcluded: false,
                    unique: false,
                    index: i + 1, // 1-based indexing
                    dataType: '',
                    description: '',
                    example: '',
                    regex: ''
                };
            }
        } else if (newColumns.length > originalColumns.length) {
            for (let i = originalColumns.length; i < newColumns.length; i++) {
                const missingKey = `MISSING_ORIGINAL_${i}`;
                const newColInfo = newColumns[i];
                const isExcluded = excludedColumns.includes(newColInfo.name);
                const isUnique = uniqueColumns.includes(newColInfo.name);
                columnMapping[missingKey] = {
                    name: newColInfo.name,
                    isExcluded: isExcluded,
                    unique: isUnique,
                    index: i + 1, // 1-based indexing
                    dataType: newColInfo.dataType,
                    description: newColInfo.description,
                    example: newColInfo.example,
                    regex: newColInfo.regex
                };
            }
        }

        // Write mapping to JSON file
        fs.writeFileSync(COLUMN_MAPPING_PATH, JSON.stringify(columnMapping, null, 2), 'utf-8');

        // Column mapping created silently

        return columnMapping;

    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log(`❌ Log file not found: ${logFilePath}`);
        } else {
            console.log(`❌ Error creating column mapping: ${error.message}`);
        }
        return null;
    }
}

/**
 * Parse a CSV line properly handling quotes and commas
 */
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    let i = 0;

    while (i < line.length) {
        const char = line[i];
        
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                // Escaped quote
                current += '"';
                i += 2;
            } else {
                // Toggle quote state
                inQuotes = !inQuotes;
                i++;
            }
        } else if (char === ',' && !inQuotes) {
            // Field separator
            result.push(current.trim());
            current = '';
            i++;
        } else {
            current += char;
            i++;
        }
    }
    
    // Add the last field
    result.push(current.trim());
    
    return result;
}

/**
 * Parse a schema line using ^ as regex delimiter for more reliable parsing
 * Format: data_title,data_type,data_description,data_example,data_regex
 */
function parseSchemaLine(line) {
    try {
        // Find the regex part first (starts with ^)
        const regexMatch = line.match(/,(\^[^,]*(?:,.*)?$)/);
        let regex = '';
        let csvPart = line;
        
        if (regexMatch) {
            regex = regexMatch[1].trim();
            // Remove the regex part from the line for easier CSV parsing
            csvPart = line.substring(0, line.lastIndexOf(regexMatch[0]));
        }
        
        // Parse the remaining CSV parts
        const parts = parseCSVLine(csvPart);
        
        if (parts.length >= 1) {
            return {
                name: parts[0].trim(),
                dataType: parts.length >= 2 ? parts[1].trim() : '',
                description: parts.length >= 3 ? parts[2].trim() : '',
                example: parts.length >= 4 ? parts[3].trim() : '',
                regex: regex
            };
        }
        
        return null;
    } catch (error) {
        console.log(`⚠️  Could not parse schema line: ${line.substring(0, 50)}... (Error: ${error.message})`);
        return null;
    }
}

/**
 * CLI interface
 */
async function setupCLI() {
    program
        .name('architect')
        .description('Process first x rows of CSV with Gemini for schema design.')
        .version('1.0.0');

    program
        .option('-x, --sample-size <number>', `Number of first rows to process from the CSV (default: ${DEFAULT_SAMPLE_SIZE})`, parseInt)
        .option('-i, --instructions', 'Use custom instructions from instructions.txt file (defined in config.json)')
        .option('-m, --model <model>', 'AI model to use for processing')
        .option('--list-models', 'List available AI models')
        .option('--create-mapping', 'Only create column mapping from existing architect output');

    program.parse();
    const options = program.opts();

    try {
        // Handle list models option
        if (options.listModels) {
            console.log('🤖 Fetching available AI models...');
            const models = await getAvailableModels();
            if (models.length > 0) {
                console.log('✅ Available models:');
                models.forEach((model, index) => {
                    console.log(`  ${index + 1}. ${model}`);
                });
            } else {
                console.log('❌ No models available or could not fetch models');
            }
            return;
        }

        // Handle custom instructions from config-defined file
        let customInstructions = null;
        if (options.instructions) {
            const configDir = config._configPath ? path.dirname(config._configPath) : process.cwd();
            const settingsDir = path.resolve(configDir, config.settings__dir || 'settings');
            const instructionsFilePath = path.join(settingsDir, config.settings_instructions_file_path || 'instructions.txt');
            
            try {
                customInstructions = fs.readFileSync(instructionsFilePath, 'utf-8').trim();
                console.log(`📄 Loaded custom instructions from: ${instructionsFilePath}`);
            } catch (error) {
                console.log(`❌ Instructions file not found: ${instructionsFilePath}`);
                console.log(`💡 Create an instructions.txt file in the settings directory to use custom instructions`);
                process.exit(1);
            }
        }

        if (options.createMapping) {
            // Only create column mapping without running architect
            console.log('🔄 Creating column mapping from existing architect log...');
            const mapping = await createColumnMapping();
            if (mapping) {
                console.log('✅ Column mapping completed successfully');
            } else {
                console.log('❌ Failed to create column mapping');
                process.exit(1);
            }
        } else {
            const sampleSize = options.sampleSize || DEFAULT_SAMPLE_SIZE;
            await main(sampleSize, customInstructions, null, null, options.model);
        }
    } catch (error) {
        console.error('❌ Fatal error:', error.message);
        process.exit(1);
    }
}

// Export functions for use in other modules
export {
    getFirstCSVRows,
    main,
    createColumnMapping,
    parseCSVLine,
    parseSchemaLine,
    loadConfig,
    getAvailableModels
};

// Run CLI if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    setupCLI();
}
