import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import csv from 'csv-parser';
import axios from 'axios';
import chalk from 'chalk';

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
            data_deduped_file_path: "data_deduped.csv",
            outputs_dir: "outputs"
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

const INPUT_CSV_PATH = path.join(dataDir, config.data_cleaned_file_path || 'data_cleaned.csv');
const OUTPUT_CSV_PATH = path.join(dataDir, config.data_deduped_file_path || 'data_deduped.csv');
const COLUMN_MAPPING_PATH = path.join(outputsDir, 'column_mapping.json');
const DEDUPE_LOG_PATH = path.join(outputsDir, 'dedupe_log.txt');
const DEDUPE_REPORT_PATH = path.join(outputsDir, 'dedupe_report.txt');

/**
 * Load full column mapping
 */
function getColumnMapping() {
    try {
        if (!fs.existsSync(COLUMN_MAPPING_PATH)) {
            console.log(`⚠️  Column mapping file not found: ${COLUMN_MAPPING_PATH}`);
            return null;
        }

        const mappingContent = fs.readFileSync(COLUMN_MAPPING_PATH, 'utf-8');
        return JSON.parse(mappingContent);
    } catch (error) {
        console.log(`⚠️  Error reading column mapping: ${error.message}`);
        return null;
    }
}

/**
 * Load column mapping and find unique columns
 */
function getUniqueColumns() {
    try {
        const columnMapping = getColumnMapping();
        if (!columnMapping) {
            return [];
        }
        
        const uniqueColumns = [];
        
        // Find original column names that are marked as unique
        Object.entries(columnMapping).forEach(([originalColumn, mapping]) => {
            if (mapping.unique === true) {
                uniqueColumns.push({
                    originalName: originalColumn,
                    mappedName: mapping.name,
                    isExcluded: mapping.isExcluded || false
                });
            }
        });
        
        return uniqueColumns;
    } catch (error) {
        console.log(`⚠️  Error reading column mapping: ${error.message}`);
        return [];
    }
}

/**
 * Create mapped headers from original headers using column mapping
 */
function createMappedHeaders(originalHeaders) {
    const columnMapping = getColumnMapping();
    if (!columnMapping) {
        return originalHeaders; // Fallback to original headers
    }
    
    return originalHeaders.map(originalHeader => {
        const mapping = columnMapping[originalHeader];
        return mapping ? mapping.name : originalHeader;
    });
}

/**
 * Properly quote a CSV header if it contains commas, quotes, or newlines
 */
function quoteCsvHeader(header) {
    if (typeof header === 'string' && (header.includes(',') || header.includes('"') || header.includes('\n'))) {
        return '"' + header.replace(/"/g, '""') + '"';
    }
    return header;
}

class CSVDeduplicator {
    constructor(options = {}) {
        this.config = {
            uniqueColumns: options.uniqueColumns || [],  // Columns to use for deduplication
            threshold: options.threshold || 0.85,        // Similarity threshold
            strategy: options.strategy || 'levenshtein', // Matching strategy
            showInput: options.showInput || false,       // Show formatted input without sending to AI
            email: options.email || null,
            apiKey: options.apiKey || null,
            model: options.model || null
        };
        this.stats = {
            originalCount: 0,
            duplicateGroups: 0,
            duplicatesRemoved: 0,
            finalCount: 0
        };
    }

    // Levenshtein distance calculation
    levenshteinDistance(str1, str2) {
        const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
        
        for (let i = 0; i <= str1.length; i++) {
            matrix[0][i] = i;
        }
        
        for (let j = 0; j <= str2.length; j++) {
            matrix[j][0] = j;
        }
        
        for (let j = 1; j <= str2.length; j++) {
            for (let i = 1; i <= str1.length; i++) {
                const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
                matrix[j][i] = Math.min(
                    matrix[j][i - 1] + 1,     // deletion
                    matrix[j - 1][i] + 1,     // insertion
                    matrix[j - 1][i - 1] + cost // substitution
                );
            }
        }
        
        return matrix[str2.length][str1.length];
    }

    // Calculate similarity ratio (0-1)
    similarity(str1, str2) {
        const maxLen = Math.max(str1.length, str2.length);
        if (maxLen === 0) return 1;
        return 1 - (this.levenshteinDistance(str1, str2) / maxLen);
    }

    // Jaccard similarity for word-based comparison
    jaccardSimilarity(str1, str2) {
        const words1 = str1.split(/\s+/).filter(w => w.length > 0);
        const words2 = str2.split(/\s+/).filter(w => w.length > 0);
        
        const set1 = new Set(words1);
        const set2 = new Set(words2);
        
        const intersection = new Set([...set1].filter(x => set2.has(x)));
        const union = new Set([...set1, ...set2]);
        
        return union.size === 0 ? 0 : intersection.size / union.size;
    }

    // Normalize strings for comparison (always case insensitive for better matching)
    normalize(str) {
        if (!str) return '';
        
        let normalized = str.toString().toLowerCase();
        
        // Trim whitespace and normalize
        normalized = normalized
            .trim()
            .replace(/[^\w\s'-]/g, ' ')  // Keep apostrophes and hyphens
            .replace(/\s+/g, ' ')        // Normalize spaces
            .trim();
        
        return normalized;
    }

    // Get comparison string based on unique columns
    getComparisonString(record) {
        const uniqueColumns = this.config.uniqueColumns;
        
        if (uniqueColumns.length === 0) {
            return '';
        }
        
        // Combine all unique columns into a single comparison string
        const values = uniqueColumns.map(col => {
            const value = record[col.originalName] || '';
            return this.normalize(value);
        }).filter(v => v.length > 0);
        
        return values.join(' ');
    }

    // Calculate similarity based on strategy
    calculateSimilarity(str1, str2) {
        switch (this.config.strategy) {
            case 'levenshtein':
                return this.similarity(str1, str2);
            case 'jaccard':
                return this.jaccardSimilarity(str1, str2);
            case 'combined':
                const levScore = this.similarity(str1, str2);
                const jaccardScore = this.jaccardSimilarity(str1, str2);
                return (levScore * 0.7) + (jaccardScore * 0.3);
            default:
                return this.similarity(str1, str2);
        }
    }

    // Find potential duplicate groups using unique columns
    findPotentialDuplicates(records) {
        const groups = [];
        const used = new Set();
        
        this.stats.originalCount = records.length;
        
        for (let i = 0; i < records.length; i++) {
            if (used.has(i)) continue;
            
            const currentStr = this.getComparisonString(records[i]);
            if (!currentStr) continue; // Skip empty values
            
            const group = {
                representative: { record: records[i], index: i, similarity: 1.0 },
                duplicates: [],
                uniqueColumns: this.config.uniqueColumns.map(col => col.originalName),
                comparisonValue: currentStr
            };
            
            for (let j = i + 1; j < records.length; j++) {
                if (used.has(j)) continue;
                
                const candidateStr = this.getComparisonString(records[j]);
                if (!candidateStr) continue;
                
                const sim = this.calculateSimilarity(currentStr, candidateStr);
                
                if (sim >= this.config.threshold) {
                    group.duplicates.push({
                        record: records[j],
                        index: j,
                        similarity: sim,
                        comparisonValue: candidateStr
                    });
                    used.add(j);
                }
            }
            
            if (group.duplicates.length > 0) {
                groups.push(group);
            }
            
            used.add(i);
        }
        
        return groups;
    }

    // Format potential duplicates for AI processing
    formatPotentialDuplicatesForAI(duplicateGroups, originalHeaders) {
        if (duplicateGroups.length === 0) {
            return '';
        }

        // Create mapped headers using the column mapping
        const mappedHeaders = createMappedHeaders(originalHeaders);
        
        // Add ID as the first column
        const headersWithId = ['ID', ...mappedHeaders];
        
        // Properly quote headers that contain commas, quotes, or newlines
        const quotedHeaders = headersWithId.map(quoteCsvHeader);

        let formatted = '<potential_duplicates>\n';
        formatted += quotedHeaders.join(',') + '\n';
        
        duplicateGroups.forEach((group, groupIndex) => {
            formatted += `<group_${groupIndex + 1}>\n`;
            
            // Add representative with ID
            const repValues = ['ID', ...originalHeaders].map((header, index) => {
                let value;
                if (header === 'ID') {
                    value = group.representative.index + 1; // 1-based ID
                } else {
                    value = group.representative.record[header] || '';
                }
                
                if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
                    value = '"' + value.replace(/"/g, '""') + '"';
                }
                return value;
            });
            formatted += repValues.join(',') + '\n';
            
            // Add duplicates with ID
            group.duplicates.forEach(dup => {
                const dupValues = ['ID', ...originalHeaders].map((header, index) => {
                    let value;
                    if (header === 'ID') {
                        value = dup.index + 1; // 1-based ID
                    } else {
                        value = dup.record[header] || '';
                    }
                    
                    if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
                        value = '"' + value.replace(/"/g, '""') + '"';
                    }
                    return value;
                });
                formatted += dupValues.join(',') + '\n';
            });
            
            formatted += `</group_${groupIndex + 1}>\n`;
        });
        
        formatted += '</potential_duplicates>';
        return formatted;
    }

    // Send to AI API for deduplication decisions
    async sendToAI(potentialDuplicatesXML, uniqueColumns) {
        try {
            if (!this.config.email || !this.config.apiKey) {
                throw new Error('Email and API key are required for AI processing');
            }

            const response = await axios.post(`${API_BASE_URL}/api/dedupe/process`, {
                potentialDuplicates: potentialDuplicatesXML,
                uniqueColumns: uniqueColumns.map(col => col.originalName),
                model: this.config.model
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Email': this.config.email,
                    'X-API-Key': this.config.apiKey
                },
                timeout: 300000 // 5 minute timeout
            });

            if (response.data && response.data.result) {
                return { success: true, result: response.data.result };
            } else {
                return { success: false, error: 'Invalid response from AI API' };
            }
        } catch (error) {
            console.error('AI API Error:', error);
            if (error.response) {
                return { 
                    success: false, 
                    error: `AI API Error (${error.response.status}): ${error.response.data?.error || error.response.statusText}` 
                };
            } else if (error.code === 'ECONNREFUSED') {
                return { success: false, error: 'Could not connect to AI API service' };
            } else if (error.code === 'ETIMEDOUT') {
                return { success: false, error: 'AI API request timed out' };
            } else {
                return { success: false, error: error.message };
            }
        }
    }

    // Parse AI response to get records to remove
    parseAIResponse(aiResponse, duplicateGroups) {
        try {
            console.log('🔍 Parsing AI response:', aiResponse.substring(0, 500) + (aiResponse.length > 500 ? '...' : ''));
            
            // The AI returns the record to KEEP for each group
            // We need to remove all OTHER records in each group
            const indicesToRemove = [];
            
            // Find all group blocks in AI response
            const groupMatches = aiResponse.matchAll(/<group_(\d+)>([\s\S]*?)<\/group_\1>/g);
            
            for (const match of groupMatches) {
                const groupNumber = parseInt(match[1]) - 1; // Convert to 0-based group index
                const groupContent = match[2].trim();
                
                if (groupContent && duplicateGroups[groupNumber]) {
                    // Group has content - extract the ID of record to KEEP
                    const keepIdMatch = groupContent.match(/^(\d+),/);
                    if (keepIdMatch) {
                        const keepId = parseInt(keepIdMatch[1]);
                        const keepIndex = keepId - 1; // Convert to 0-based index
                        
                        console.log(`📋 Group ${groupNumber + 1}: AI wants to KEEP ID ${keepId} (index ${keepIndex})`);
                        
                        // Get all record indices in this duplicate group
                        const group = duplicateGroups[groupNumber];
                        const allIndicesInGroup = [
                            group.representative.index,
                            ...group.duplicates.map(dup => dup.index)
                        ];
                        
                        // Remove all indices EXCEPT the one the AI wants to keep
                        const toRemove = allIndicesInGroup.filter(index => index !== keepIndex);
                        indicesToRemove.push(...toRemove);
                        
                        console.log(`📋 Group ${groupNumber + 1}: Removing indices [${toRemove.join(', ')}], keeping index ${keepIndex}`);
                    }
                } else {
                    console.log(`📋 Group ${groupNumber + 1}: Empty or no group data - no duplicates to remove`);
                }
            }
            
            if (indicesToRemove.length > 0) {
                // Remove duplicates and sort
                const uniqueIndicesToRemove = [...new Set(indicesToRemove)].sort((a, b) => a - b);
                console.log('📋 Final indices to remove:', uniqueIndicesToRemove);
                return { success: true, indicesToRemove: uniqueIndicesToRemove };
            }
            
            // Try JSON array as fallback (assume these are IDs to remove directly)
            const jsonMatch = aiResponse.match(/\[[\d\s,]+\]/);
            if (jsonMatch) {
                try {
                    const idsToRemove = JSON.parse(jsonMatch[0]);
                    console.log('📋 Found JSON array - treating as IDs to remove:', idsToRemove);
                    const indicesToRemove = idsToRemove.map(id => parseInt(id) - 1).filter(index => index >= 0);
                    console.log('📋 Converted to indices:', indicesToRemove);
                    return { success: true, indicesToRemove };
                } catch (parseError) {
                    console.log('⚠️  Failed to parse JSON array:', parseError.message);
                }
            }
            
            console.log('📋 No records to remove - no duplicates found');
            return { success: true, indicesToRemove: [] };
        } catch (error) {
            console.log('❌ Error parsing AI response:', error.message);
            return { success: false, error: `Error parsing AI response: ${error.message}` };
        }
    }

    // Generate cleaned dataset based on AI decisions
    generateCleanedData(records, indicesToRemove) {
        const removedSet = new Set(indicesToRemove);
        const cleanedRecords = records.filter((_, index) => !removedSet.has(index));
        
        this.stats.duplicatesRemoved = indicesToRemove.length;
        this.stats.finalCount = cleanedRecords.length;
        
        return cleanedRecords;
    }

    // Generate duplicate report
    generateReport(duplicateGroups, aiResponse, indicesToRemove) {
        let report = 'CSV AI-Powered Deduplication Report\n';
        report += '====================================\n\n';
        report += `Configuration:\n`;
        report += `- Unique Columns: ${this.config.uniqueColumns.map(col => col.originalName).join(', ')}\n`;
        report += `- Threshold: ${this.config.threshold}\n`;
        report += `- Strategy: ${this.config.strategy}\n`;
        report += `- AI Model: ${this.config.model || 'default'}\n`;
        report += `- Show Input Only: ${this.config.showInput}\n\n`;
        
        report += `Statistics:\n`;
        report += `- Original Records: ${this.stats.originalCount}\n`;
        report += `- Potential Duplicate Groups Found: ${duplicateGroups.length}\n`;
        report += `- Records Removed by AI: ${this.stats.duplicatesRemoved}\n`;
        report += `- Final Record Count: ${this.stats.finalCount}\n`;
        report += `- Deduplication Rate: ${((this.stats.duplicatesRemoved / this.stats.originalCount) * 100).toFixed(2)}%\n\n`;
        
        if (duplicateGroups.length > 0) {
            report += 'Potential Duplicate Groups Found:\n';
            report += '==================================\n\n';
            
            duplicateGroups.forEach((group, groupIndex) => {
                report += `Group ${groupIndex + 1}:\n`;
                report += `Representative: ${JSON.stringify(group.representative.record)}\n`;
                report += `Potential Duplicates:\n`;
                group.duplicates.forEach((dup, dupIndex) => {
                    report += `  ${dupIndex + 1}. ${JSON.stringify(dup.record)} (Similarity: ${(dup.similarity * 100).toFixed(2)}%)\n`;
                });
                report += '\n';
            });
        }
        
        report += '\nAI Decision:\n';
        report += '============\n';
        report += aiResponse + '\n\n';
        
        report += `Records Removed: ${indicesToRemove.join(', ')}\n`;
        
        return report;
    }

    // Convert records back to CSV
    toCSV(records, headers) {
        if (records.length === 0) return '';
        
        const csvLines = [headers.join(',')];
        
        records.forEach(record => {
            const line = headers.map(header => {
                let value = record[header] || '';
                if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
                    value = '"' + value.replace(/"/g, '""') + '"';
                }
                return value;
            }).join(',');
            csvLines.push(line);
        });
        
        return csvLines.join('\n');
    }
}

/**
 * Read CSV file and return array of objects with headers
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
 * Main deduplication function
 */
async function main(options = {}) {
    try {
        // Get unique columns from column mapping
        const uniqueColumns = getUniqueColumns();
        
        // Check if there are any unique columns
        if (uniqueColumns.length === 0) {
            console.log('ℹ️  No highly identifiable columns found in column mapping - skipping deduplication');
            console.log('💡 To enable deduplication, mark columns as unique in the architect output using ```UNIQUE``` prefix');
            return {
                success: true,
                skipped: true,
                reason: 'No unique columns found',
                stats: null,
                uniqueColumns: [],
                duplicateGroups: 0,
                outputPath: null,
                reportPath: null
            };
        }
        
        // Log which columns will be used for deduplication
        console.log(`🔍 Found ${uniqueColumns.length} unique column(s) for AI-powered deduplication:`);
        uniqueColumns.forEach(col => {
            const status = col.isExcluded ? ' (excluded from final output)' : '';
            console.log(`   - ${col.originalName} → ${col.mappedName}${status}`);
        });

        // Ensure output directory exists
        if (!fs.existsSync(outputsDir)) {
            fs.mkdirSync(outputsDir, { recursive: true });
        }

        // Check if input file exists
        if (!fs.existsSync(INPUT_CSV_PATH)) {
            throw new Error(`Input CSV file not found: ${INPUT_CSV_PATH}`);
        }

        // Read CSV data
        const { data: records, headers } = await readCSV(INPUT_CSV_PATH);
        
        if (records.length === 0) {
            throw new Error('No data found in CSV file');
        }

        // Initialize deduplicator with unique columns
        const deduplicator = new CSVDeduplicator({
            ...options,
            uniqueColumns: uniqueColumns
        });
        
        // Find potential duplicates
        const duplicateGroups = deduplicator.findPotentialDuplicates(records);
        
        if (duplicateGroups.length === 0) {
            console.log('✅ No potential duplicates found with current settings!');
            
            // Write empty report
            const reportContent = deduplicator.generateReport([], 'No potential duplicates found.', []);
            fs.writeFileSync(DEDUPE_REPORT_PATH, reportContent, 'utf-8');
            
            // Copy input to output since no changes needed
            const originalCSV = deduplicator.toCSV(records, headers);
            fs.writeFileSync(OUTPUT_CSV_PATH, originalCSV, 'utf-8');
            
            return {
                success: true,
                skipped: false,
                stats: {
                    originalCount: records.length,
                    duplicateGroups: 0,
                    duplicatesRemoved: 0,
                    finalCount: records.length
                },
                uniqueColumns: uniqueColumns.map(col => col.originalName),
                duplicateGroups: 0,
                outputPath: OUTPUT_CSV_PATH,
                reportPath: DEDUPE_REPORT_PATH
            };
        }
        
        console.log(`🤖 Found ${duplicateGroups.length} potential duplicate groups.`);
        
        // Format for AI processing
        const potentialDuplicatesXML = deduplicator.formatPotentialDuplicatesForAI(duplicateGroups, headers);
        
        // If show-input mode, display the formatted input and exit
        if (deduplicator.config.showInput) {
            console.log(chalk.bold.cyan('\n📋 Formatted Input for AI:'));
            console.log(chalk.gray('='.repeat(80)));
            console.log(potentialDuplicatesXML);
            console.log(chalk.gray('='.repeat(80)));
            console.log(chalk.yellow('\n👀 This is the input that would be sent to the AI for deduplication decisions.'));
            console.log(chalk.cyan('Run without --show-input to perform actual AI analysis.'));
            
            return {
                success: true,
                skipped: false,
                showInput: true,
                stats: {
                    originalCount: records.length,
                    duplicateGroups: duplicateGroups.length,
                    duplicatesRemoved: 0,
                    finalCount: records.length
                },
                uniqueColumns: uniqueColumns.map(col => col.originalName),
                duplicateGroups: duplicateGroups.length,
                outputPath: null,
                reportPath: null
            };
        }
        
        console.log('🚀 Sending to AI for analysis...');
        
        // Send to AI for decision making
        const aiResult = await deduplicator.sendToAI(potentialDuplicatesXML, uniqueColumns);
        
        // Always write log regardless of what happens next
        const writeLog = (response, indices, error = null) => {
            const logContent = [
                '=== AI-POWERED DEDUPLICATION CONFIGURATION ===',
                JSON.stringify({
                    ...deduplicator.config,
                    uniqueColumns: uniqueColumns
                }, null, 2),
                '\n=== STATISTICS ===',
                JSON.stringify(deduplicator.stats, null, 2),
                '\n=== UNIQUE COLUMNS USED ===',
                JSON.stringify(uniqueColumns, null, 2),
                '\n=== AI INPUT (FORMATTED XML) ===',
                potentialDuplicatesXML,
                '\n=== AI RESPONSE ===',
                response || 'No response received',
                '\n=== INDICES TO REMOVE ===',
                JSON.stringify(indices || []),
                error ? '\n=== ERROR ===\n' + error : ''
            ].join('\n');
            
            fs.writeFileSync(DEDUPE_LOG_PATH, logContent, 'utf-8');
        };
        
        if (!aiResult.success) {
            writeLog('AI processing failed', [], aiResult.error);
            throw new Error(`AI processing failed: ${aiResult.error}`);
        }
        
        console.log('🧠 AI analysis complete. Processing decisions...');
        
        // Parse AI response to get records to remove
        const parseResult = deduplicator.parseAIResponse(aiResult.result, duplicateGroups);
        
        if (!parseResult.success) {
            writeLog(aiResult.result, [], parseResult.error);
            throw new Error(`Failed to parse AI response: ${parseResult.error}`);
        }
        
        const indicesToRemove = parseResult.indicesToRemove || [];
        
        // Write log with successful results
        writeLog(aiResult.result, indicesToRemove);
        
        // Generate cleaned data
        const cleanedRecords = deduplicator.generateCleanedData(records, indicesToRemove);
        
        // Generate report
        const reportContent = deduplicator.generateReport(duplicateGroups, aiResult.result, indicesToRemove);
        
        // Write report
        fs.writeFileSync(DEDUPE_REPORT_PATH, reportContent, 'utf-8');

        // Write cleaned CSV
        const cleanedCSV = deduplicator.toCSV(cleanedRecords, headers);
        fs.writeFileSync(OUTPUT_CSV_PATH, cleanedCSV, 'utf-8');

        return {
            success: true,
            skipped: false,
            stats: deduplicator.stats,
            uniqueColumns: uniqueColumns.map(col => col.originalName),
            duplicateGroups: duplicateGroups.length,
            outputPath: OUTPUT_CSV_PATH,
            reportPath: DEDUPE_REPORT_PATH
        };

    } catch (error) {
        throw new Error(`AI-powered deduplication failed: ${error.message}`);
    }
}

// Export functions
export {
    main,
    CSVDeduplicator,
    loadConfig,
    readCSV,
    getUniqueColumns,
    getColumnMapping,
    createMappedHeaders,
    quoteCsvHeader
}; 