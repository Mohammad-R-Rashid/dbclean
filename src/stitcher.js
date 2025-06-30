#!/usr/bin/env node

/**
 * Stitcher module for creating the final stitched CSV.
 * 
 * This module:
 * 1. Duplicates data_cleaned.csv as data_stitched.csv
 * 2. Renames headers using column_mapping.json
 * 3. Replaces architect-processed rows with semantic_diff data
 * 4. Applies cleaner changes to specific columns
 * 5. Leaves remaining data unchanged for now
 */

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import csv from 'csv-parser';
import { createObjectCsvWriter } from 'csv-writer';
import chalk from 'chalk';
import open from 'open';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
            data_stitched_file_path: "data_stitched.csv",
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
 * Load column mapping from JSON file
 */
function loadColumnMapping(mappingFile) {
    try {
        const content = fs.readFileSync(mappingFile, 'utf-8');
        return JSON.parse(content);
    } catch (error) {
        console.log(chalk.red(`❌ Error loading column mapping: ${error.message}`));
        return {};
    }
}

/**
 * Extract semantic_diff section from architect output
 */
function extractSemanticDiffFromArchitect(architectOutputFile) {
    try {
        const content = fs.readFileSync(architectOutputFile, 'utf-8');
        const diffMatch = content.match(/<semantic_diff>(.*?)<\/semantic_diff>/s);
        return diffMatch ? diffMatch[1].trim() : '';
    } catch (error) {
        console.log(chalk.red(`❌ Error extracting semantic_diff: ${error.message}`));
        return '';
    }
}

/**
 * Parse architect semantic_diff to get corrected rows
 */
function parseArchitectSemanticDiff(semanticDiff) {
    const correctedRows = {};
    
    const lines = semanticDiff.split('\n');
    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;
        
        // Skip lines that indicate existing data
        if (trimmedLine.includes('… Existing Data …') || trimmedLine.includes('... Existing Data ...')) {
            continue;
        }
        
        // Handle flagged lines - remove the FLAGGED prefix but still process the data
        let processLine = trimmedLine;
        if (processLine.startsWith('```FLAGGED')) {
            // Remove the FLAGGED prefix and any metadata before the actual CSV data
            processLine = processLine.replace(/^```FLAGGED[^`]*```/, '').trim();
            console.log(chalk.yellow(`🚩 Processing flagged row: ${processLine.substring(0, 50)}...`));
        }
        
        // Parse CSV line that starts with row ID
        if (/^\d+,/.test(processLine)) {
            try {
                const rowData = parseCSVLine(processLine);
                if (rowData.length > 0) {
                    const rowId = parseInt(rowData[0]);
                    // Convert the entire row to a list (excluding the ID)
                    const rowValues = rowData.slice(1);
                    correctedRows[rowId] = rowValues;
                }
            } catch (error) {
                console.log(chalk.yellow(`⚠️  Could not parse semantic_diff line: ${processLine.substring(0, 50)}...`));
                continue;
            }
        }
    }
    
    return correctedRows;
}

/**
 * Parse a CSV line properly handling quotes and commas
 */
function parseCSVLine(line) {
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
 * Extract semantic_diff section from cleaner output file
 */
function extractSemanticDiffFromCleanerOutput(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const diffMatch = content.match(/<semantic_diff>(.*?)<\/semantic_diff>/s);
        return diffMatch ? diffMatch[1].trim() : '';
    } catch (error) {
        console.log(chalk.red(`❌ Error reading ${filePath}: ${error.message}`));
        return '';
    }
}

/**
 * Parse semantic_diff to extract row IDs, corrected values, flagged status, and flag reason
 */
function parseSemanticDiffChanges(semanticDiff) {
    const changes = [];

    const lines = semanticDiff.split('\n');
    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        // Skip lines that indicate existing data
        if (trimmedLine.includes('… Existing Data …') || trimmedLine.includes('... Existing Data ...')) {
            continue;
        }

        // Parse lines that start with row ID
        if (/^\d+,/.test(trimmedLine)) {
            try {
                // Split on first comma to get ID and value
                const commaIdx = trimmedLine.indexOf(',');
                if (commaIdx > 0) {
                    const rowId = parseInt(trimmedLine.substring(0, commaIdx));
                    let correctedValue = trimmedLine.substring(commaIdx + 1);

                    // Remove quotes if present (we'll add them back if needed)
                    if (correctedValue.startsWith('"') && correctedValue.endsWith('"')) {
                        correctedValue = correctedValue.slice(1, -1);
                    }

                    changes.push({
                        rowId,
                        correctedValue,
                    });
                }
            } catch (error) {
                console.log(chalk.yellow(`⚠️  Could not parse line: ${trimmedLine.substring(0, 50)}... (Error: ${error.message})`));
                continue;
            }
        }
    }

    return changes;
}

/**
 * Extract column name from cleaner output filename
 */
function getColumnNameFromFilename(filename) {
    // Remove _output.txt or _batch_X_output.txt suffix
    let name = filename.replace('_output.txt', '');
    name = name.replace(/_batch_\d+$/, '');
    return name;
}

/**
 * Find the column index by the new column name
 */
function findColumnIndexByNewName(columnMapping, newName) {
    for (const [originalName, info] of Object.entries(columnMapping)) {
        if (info.name === newName) {
            return info.index - 1; // Convert to 0-based index
        }
    }
    return -1;
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
 * Check if a value is empty/null/undefined (from cleaner.js)
 */
function isEmptyValue(value) {
    return value === null || value === undefined || value === '' ||
           value === 'NaN' ||
           value === 'nan' || value === 'undefined' ||
           (typeof value === 'string' && value.trim() === '');
}

/**
 * Test if a value matches the expected regex pattern (from cleaner.js)
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
 * Validate all data against regex patterns and return statistics
 */
function validateDataAgainstRegex(data, columnMapping) {
    const results = {};
    const dataHeaders = data.length > 0 ? Object.keys(data[0]) : [];
    
    // For each column in the mapping
    for (const [originalColumnName, columnInfo] of Object.entries(columnMapping)) {
        const { name: columnName, regex, isExcluded, index } = columnInfo;
        
        // Skip excluded columns
        if (isExcluded) {
            continue;
        }
        
        // Skip columns with catch-all regex
        if (regex === '^.*$') {
            continue;
        }
        
        // Find the column in the data by its new name
        const columnIndex = index - 1; // Convert to 0-based
        if (columnIndex < 0 || columnIndex >= dataHeaders.length) {
            continue;
        }
        
        const columnHeader = dataHeaders[columnIndex];
        
        let validCount = 0;
        let invalidCount = 0;
        let emptyCount = 0;
        const invalidRows = [];
        
        for (const [idx, row] of data.entries()) {
            const value = row[columnHeader];
            
            if (isEmptyValue(value)) {
                emptyCount++;
                validCount++; // Empty values are considered valid
            } else if (testRegexMatch(value, regex)) {
                validCount++;
            } else {
                invalidCount++;
                invalidRows.push({ rowId: idx + 1, value });
            }
        }
        
        const totalCount = data.length;
        const validPercentage = totalCount > 0 ? (validCount / totalCount * 100).toFixed(2) : 0;
        const invalidPercentage = totalCount > 0 ? (invalidCount / totalCount * 100).toFixed(2) : 0;
        
        results[columnName] = {
            originalColumnName,
            columnHeader,
            regex,
            totalCount,
            validCount,
            invalidCount,
            emptyCount,
            validPercentage: parseFloat(validPercentage),
            invalidPercentage: parseFloat(invalidPercentage),
            invalidRows
        };
    }
    
    return results;
}

/**
 * Apply cleaner changes to the DataFrame and create analysis log
 */
async function applyCleanerChanges(data, columnMapping) {
    
    // Paths
    const cleanerOutputDir = path.join(outputsDir, config.outputs_cleaned_columns_dir || 'cleaned_columns', 'outputs');
    const htmlOutputPath = path.join(outputsDir, config.outputs_cleaner_changes_analysis_file || 'cleaner_changes_analysis.html');
    
    console.log(chalk.blue('🧹 Applying cleaner column changes...'));
    
    // Run regex validation BEFORE applying cleaner changes
    console.log(chalk.blue('🔍 Running regex validation on pre-cleaner data...'));
    const preCleanerValidation = validateDataAgainstRegex(data, columnMapping);
    console.log(chalk.green(`✅ Pre-cleaner validation completed for ${Object.keys(preCleanerValidation).length} columns`));
    
    // Get all cleaner output files
    if (!fs.existsSync(cleanerOutputDir)) {
        console.log(chalk.yellow(`⚠️  Cleaner output directory not found: ${cleanerOutputDir}`));
        console.log('   Skipping cleaner changes application');
        return true; // Not an error, just no cleaner outputs to apply
    }
    
    const outputFiles = fs.readdirSync(cleanerOutputDir).filter(f => f.endsWith('_output.txt'));
    if (outputFiles.length === 0) {
        console.log(chalk.yellow('⚠️  No cleaner output files found'));
        console.log('   Skipping cleaner changes application');
        return true;
    }
    
    console.log(chalk.green(`✅ Found ${outputFiles.length} cleaner output files`));
    
    // Analyze each file and collect changes
    const allChanges = [];
    let totalApplied = 0;
    
    for (const filename of outputFiles.sort()) {
        const filePath = path.join(cleanerOutputDir, filename);
        const columnName = getColumnNameFromFilename(filename);
        
        console.log(chalk.blue(`\n🔄 Processing: ${filename} (Column: ${columnName})`));
        
        // Find column index in stitched CSV
        const columnIndex = findColumnIndexByNewName(columnMapping, columnName);
        if (columnIndex === -1) {
            console.log(chalk.yellow(`⚠️  Could not find column '${columnName}' in mapping`));
            continue;
        }
        
        if (columnIndex >= data[0] ? Object.keys(data[0]).length : 0) {
            console.log(chalk.yellow(`⚠️  Column index ${columnIndex} out of range`));
            continue;
        }
        
        const columnHeaders = data.length > 0 ? Object.keys(data[0]) : [];
        const columnHeader = columnHeaders[columnIndex];
        
        // Extract semantic diff
        const semanticDiff = extractSemanticDiffFromCleanerOutput(filePath);
        if (!semanticDiff) {
            console.log(chalk.yellow(`⚠️  No semantic_diff found in ${filename}`));
            continue;
        }
        
        // Parse changes
        const changes = parseSemanticDiffChanges(semanticDiff);
        if (changes.length === 0) {
            console.log(chalk.yellow(`⚠️  No changes found in semantic_diff for ${filename}`));
            continue;
        }
        
        console.log(chalk.green(`✅ Found ${changes.length} changes in ${filename}`));
        
        // Apply changes to data and collect for analysis
        let changesApplied = 0;
        for (const change of changes) {
            const { rowId, correctedValue } = change;
            const dataIndex = rowId - 1; // Convert to 0-based
            
            if (dataIndex >= 0 && dataIndex < data.length) {
                const currentValue = data[dataIndex][columnHeader] || '';
                
                // Remove quotes from corrected_value for comparison and application
                let cleanCorrectedValue = correctedValue;
                if (cleanCorrectedValue.startsWith('"') && cleanCorrectedValue.endsWith('"')) {
                    cleanCorrectedValue = cleanCorrectedValue.slice(1, -1);
                }
                
                const needsChange = String(currentValue) !== cleanCorrectedValue;
                
                const changeInfo = {
                    filename,
                    columnName,
                    columnHeader,
                    columnIndex,
                    rowId,
                    currentValue: String(currentValue),
                    correctedValue: cleanCorrectedValue,
                    isFlagged: false, // will be updated later
                    flagReason: '',   // will be updated later
                    needsChange,
                    unableToFix: false // will be updated later
                };
                
                allChanges.push(changeInfo);
                
                // Apply the change if needed
                if (changeInfo.needsChange) {
                    data[dataIndex][columnHeader] = cleanCorrectedValue;
                    changesApplied++;
                    console.log(chalk.green(`  ✅ Applied Row ${rowId}: '${currentValue}' → '${cleanCorrectedValue}'`));
                } else {
                    console.log(chalk.white(`  ⚪ Row ${rowId}: Already correct ('${currentValue}')`));
                }
            } else {
                console.log(chalk.yellow(`  ⚠️  Row ${rowId} out of range`));
            }
        }
        
        totalApplied += changesApplied;
        console.log(chalk.blue(`📊 Applied ${changesApplied} changes from ${filename}`));
    }

    // Run regex validation AFTER applying cleaner changes
    console.log(chalk.blue('\n🔍 Running regex validation on post-cleaner data...'));
    const postCleanerValidation = validateDataAgainstRegex(data, columnMapping);
    console.log(chalk.green(`✅ Post-cleaner validation completed for ${Object.keys(postCleanerValidation).length} columns`));

    // --- NEW: Flagging logic based on post-cleaner validation ---
    console.log(chalk.blue('\n🚩 Flagging rows that fail regex validation...'));

    // Create a map of invalid rows for easy lookup
    const invalidRowMap = new Map();
    for (const [columnName, validationResult] of Object.entries(postCleanerValidation)) {
        for (const invalidRow of validationResult.invalidRows) {
            const key = `${invalidRow.rowId}:${columnName}`;
            invalidRowMap.set(key, {
                value: invalidRow.value,
                reason: `Value '${invalidRow.value}' does not match regex: ${validationResult.regex}`
            });
        }
    }

    // Update flags in allChanges for rows processed by the cleaner
    for (const changeInfo of allChanges) {
        const key = `${changeInfo.rowId}:${changeInfo.columnName}`;
        if (invalidRowMap.has(key)) {
            const flagDetails = invalidRowMap.get(key);
            changeInfo.isFlagged = true;
            changeInfo.flagReason = flagDetails.reason;
            changeInfo.unableToFix = true; // If it's still invalid after cleaner, it's considered not fixed
        }
    }
    
    // Add new "change" entries for invalid rows that were NOT processed by the cleaner
    const loggedKeys = new Set(allChanges.map(c => `${c.rowId}:${c.columnName}`));
    for (const [key, flagDetails] of invalidRowMap.entries()) {
        if (!loggedKeys.has(key)) {
            const [rowIdStr, columnName] = key.split(':');
            const rowId = parseInt(rowIdStr);
            
            const columnIndex = findColumnIndexByNewName(columnMapping, columnName);
            if (columnIndex === -1) continue;

            const columnHeaders = data.length > 0 ? Object.keys(data[0]) : [];
            const columnHeader = columnHeaders[columnIndex];

            allChanges.push({
                filename: 'N/A (Regex Validation)',
                columnName,
                columnHeader,
                columnIndex,
                rowId,
                currentValue: flagDetails.value,
                correctedValue: flagDetails.value,
                isFlagged: true,
                flagReason: flagDetails.reason,
                needsChange: false,
                unableToFix: true
            });
        }
    }
    // --- END of new logic ---

    // Write HTML report
    console.log(chalk.blue(`\n📝 Writing analysis report...`));
    
    try {
        const htmlLines = [];
        
        // Start HTML document with modern styling
        htmlLines.push(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cleaner Changes Analysis Report</title>
    <style>
        :root {
            --primary: #2563eb;
            --success: #16a34a;
            --warning: #ca8a04;
            --error: #dc2626;
            --bg-light: #f8fafc;
            --text-dark: #1e293b;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            line-height: 1.6;
            color: var(--text-dark);
            max-width: 1200px;
            margin: 0 auto;
            padding: 2rem;
            background: var(--bg-light);
        }
        .container {
            background: white;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            padding: 2rem;
            margin-bottom: 2rem;
        }
        h1, h2, h3 {
            color: var(--primary);
            margin-top: 0;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 1rem;
            margin: 1rem 0;
        }
        .stat-card {
            background: white;
            padding: 1rem;
            border-radius: 6px;
            border: 1px solid #e2e8f0;
        }
        .stat-card h4 {
            margin: 0;
            color: var(--text-dark);
        }
        .stat-value {
            font-size: 1.5rem;
            font-weight: bold;
            color: var(--primary);
        }
        .progress-bar {
            width: 100%;
            height: 8px;
            background: #e2e8f0;
            border-radius: 4px;
            margin: 0.5rem 0;
        }
        .progress-value {
            height: 100%;
            border-radius: 4px;
            background: var(--primary);
            transition: width 0.3s ease;
        }
        .badge {
            display: inline-block;
            padding: 0.25rem 0.5rem;
            border-radius: 4px;
            font-size: 0.875rem;
            font-weight: 500;
        }
        .badge-success { background: #dcfce7; color: var(--success); }
        .badge-warning { background: #fef9c3; color: var(--warning); }
        .badge-error { background: #fee2e2; color: var(--error); }
        .changes-list {
            margin-top: 1rem;
        }
        .change-item {
            border-left: 3px solid var(--primary);
            padding: 0.5rem 1rem;
            margin: 0.5rem 0;
            background: #f8fafc;
        }
        .change-item.flagged {
            border-left-color: var(--error);
        }
        .column-section {
            margin-bottom: 2rem;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            overflow: hidden;
        }
        .column-header {
            background: #f1f5f9;
            padding: 1rem;
            border-bottom: 1px solid #e2e8f0;
        }
        .column-content {
            padding: 1rem;
        }
        .improvement-arrow {
            color: var(--success);
            font-weight: bold;
        }
        .search-box {
            width: 100%;
            padding: 0.5rem;
            margin: 1rem 0;
            border: 1px solid #e2e8f0;
            border-radius: 4px;
        }
        @media (max-width: 768px) {
            body { padding: 1rem; }
            .stats-grid { grid-template-columns: 1fr; }
        }
        
        /* Add new styles for column navigation */
        .nav-columns {
            position: sticky;
            top: 1rem;
            background: white;
            padding: 1.5rem;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            margin-bottom: 1.5rem;
            z-index: 100;
        }
        .nav-columns h3 {
            margin: 0 0 1rem 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .toggle-nav-btn {
            background: #eef2ff;
            border: 1px solid #c7d2fe;
            padding: 0.25rem 0.75rem;
            border-radius: 9999px;
            cursor: pointer;
            font-size: 0.8rem;
            font-weight: 600;
            color: #4338ca;
            transition: all 0.2s;
        }
        .toggle-nav-btn:hover {
            background: #c7d2fe;
        }
        .nav-columns.collapsed .nav-columns-grid {
            display: none;
        }
        .nav-columns-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
            gap: 0.75rem;
        }
        .nav-column-btn {
            padding: 0.75rem 1rem;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            background: white;
            cursor: pointer;
            text-align: left;
            transition: all 0.2s;
            font-size: 0.9rem;
            display: flex;
            align-items: center;
            justify-content: space-between;
            color: var(--text-dark);
            font-weight: 500;
        }
        .nav-column-btn:hover {
            background: #f8fafc;
            border-color: var(--primary);
            transform: translateY(-1px);
            box-shadow: 0 2px 4px rgba(0,0,0,0.05);
        }
        .nav-column-btn .badge {
            font-size: 0.75rem;
            padding: 0.25rem 0.5rem;
            border-radius: 12px;
            font-weight: 600;
        }
        .search-box {
            width: 100%;
            padding: 0.75rem 1rem;
            border: 2px solid #e2e8f0;
            border-radius: 8px;
            font-size: 1rem;
            margin: 1.5rem 0;
            transition: all 0.2s;
        }
        .search-box:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
        }
        .no-results {
            display: none;
            color: var(--error);
            text-align: center;
            margin-top: 1rem;
        }
        .back-to-top {
            position: fixed;
            bottom: 2rem;
            right: 2rem;
            background: var(--primary);
            color: white;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            opacity: 0;
            transition: opacity 0.3s;
            text-decoration: none;
        }
        .back-to-top.visible {
            opacity: 1;
        }
        @media (max-width: 768px) {
            .nav-columns-grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <h1>🔍 Cleaner Changes Analysis Report</h1>
    <div class="container">
        <div class="nav-columns" id="navColumns">
            <h3>
                <span>📊 Column Navigation</span>
                <button id="toggleNavBtn" class="toggle-nav-btn">Hide</button>
            </h3>
            <div class="nav-columns-grid" id="columnButtons">
            </div>
        </div>
        
        <input type="text" class="search-box" id="searchBox" placeholder="🔍 Search in report (column names, values, status...)" onkeyup="filterContent()">
        <div id="noResults" class="no-results">
            No matching results found
        </div>
        
        <h2>Regex Validation Results</h2>
        <div class="stats-grid">`);

        // Calculate overall statistics
        let totalColumnsValidated = 0;
        let preCleanerValidTotal = 0;
        let preCleanerInvalidTotal = 0;
        let postCleanerValidTotal = 0;
        let postCleanerInvalidTotal = 0;
        let totalDataPoints = 0;
        
        // Column-by-column comparison
        const validatedColumns = Object.keys(preCleanerValidation);
        const significantImprovements = [];
        
        for (const columnName of validatedColumns.sort()) {
            const preCleaner = preCleanerValidation[columnName];
            const postCleaner = postCleanerValidation[columnName] || preCleaner;
            
            totalColumnsValidated++;
            preCleanerValidTotal += preCleaner.validCount;
            preCleanerInvalidTotal += preCleaner.invalidCount;
            postCleanerValidTotal += postCleaner.validCount;
            postCleanerInvalidTotal += postCleaner.invalidCount;
            totalDataPoints += preCleaner.totalCount;
            
            const improvement = postCleaner.validPercentage - preCleaner.validPercentage;
            if (improvement >= 5) {
                significantImprovements.push({ columnName, improvement });
            }
        }

        // Add overall statistics cards
        const preCleanerOverallValid = totalDataPoints > 0 ? (preCleanerValidTotal / totalDataPoints * 100).toFixed(2) : '0.00';
        const postCleanerOverallValid = totalDataPoints > 0 ? (postCleanerValidTotal / totalDataPoints * 100).toFixed(2) : '0.00';
        const overallImprovement = parseFloat(postCleanerOverallValid) - parseFloat(preCleanerOverallValid);
        
        htmlLines.push(`
            <div class="stat-card">
                <h4>Total Columns</h4>
                <div class="stat-value">${totalColumnsValidated}</div>
            </div>
            <div class="stat-card">
                <h4>Total Data Points</h4>
                <div class="stat-value">${totalDataPoints.toLocaleString()}</div>
            </div>
            <div class="stat-card">
                <h4>Overall Improvement</h4>
                <div class="stat-value ${overallImprovement >= 0 ? 'text-success' : 'text-error'}">
                    ${overallImprovement >= 0 ? '+' : ''}${overallImprovement.toFixed(2)}%
                </div>
            </div>
        </div>
        
        <h3>Validation Progress</h3>
        <div class="stats-grid">
            <div class="stat-card">
                <h4>Pre-Cleaner Valid Data</h4>
                <div class="progress-bar">
                    <div class="progress-value" style="width: ${preCleanerOverallValid}%"></div>
                </div>
                <div class="stat-value">${preCleanerOverallValid}%</div>
                <small>${preCleanerValidTotal.toLocaleString()} / ${totalDataPoints.toLocaleString()} entries</small>
            </div>
            <div class="stat-card">
                <h4>Post-Cleaner Valid Data</h4>
                <div class="progress-bar">
                    <div class="progress-value" style="width: ${postCleanerOverallValid}%"></div>
                </div>
                <div class="stat-value">${postCleanerOverallValid}%</div>
                <small>${postCleanerValidTotal.toLocaleString()} / ${totalDataPoints.toLocaleString()} entries</small>
            </div>
        </div>`);

        // Add significant improvements section if any
        if (significantImprovements.length > 0) {
            htmlLines.push(`
        <h3>Significant Improvements (≥5%)</h3>
        <div class="stats-grid">`);
            
            significantImprovements.sort((a, b) => b.improvement - a.improvement);
            for (const { columnName, improvement } of significantImprovements) {
                htmlLines.push(`
            <div class="stat-card">
                <h4>${columnName}</h4>
                <div class="stat-value improvement-arrow">↑ ${improvement.toFixed(2)}%</div>
            </div>`);
            }
            htmlLines.push(`</div>`);
        }

        // Group changes by column
        const changesByColumn = {};
        for (const change of allChanges) {
            const colName = change.columnName;
            if (!changesByColumn[colName]) {
                changesByColumn[colName] = [];
            }
            changesByColumn[colName].push(change);
        }

        // Add detailed column sections
        htmlLines.push(`
        <h2>Column Details</h2>`);

        for (const [columnName, changes] of Object.entries(changesByColumn).sort((a,b) => a[0].localeCompare(b[0]))) {
            const appliedChanges = changes.filter(c => c.needsChange).length;
            const flaggedChanges = changes.filter(c => c.isFlagged).length;
            
            htmlLines.push(`
        <div class="column-section">
            <div class="column-header">
                <h3>${columnName}</h3>
                <div class="stats-grid">
                    <div class="stat-card">
                        <h4>Total Entries</h4>
                        <div class="stat-value">${changes.length}</div>
                    </div>
                    <div class="stat-card">
                        <h4>Applied Changes</h4>
                        <div class="stat-value">${appliedChanges}</div>
                    </div>
                    <div class="stat-card">
                        <h4>Flagged Entries</h4>
                        <div class="stat-value">${flaggedChanges}</div>
                    </div>
                </div>
            </div>
            <div class="column-content">
                <div class="changes-list">`);

            for (const change of changes.sort((a, b) => a.rowId - b.rowId)) {
                const statusClass = change.isFlagged ? 'badge-error' : 
                                  change.needsChange ? 'badge-warning' : 
                                  'badge-success';
                const statusText = change.isFlagged ? 'FLAGGED' :
                                 change.needsChange ? 'CHANGED' :
                                 'VALID';
                
                htmlLines.push(`
                    <div class="change-item ${change.isFlagged ? 'flagged' : ''}">
                        <span class="badge ${statusClass}">${statusText}</span>
                        <strong>Row ${change.rowId}</strong>
                        <div>Current: "${change.currentValue}"</div>`);
                
                if (change.needsChange) {
                    htmlLines.push(`
                        <div>Corrected: "${change.correctedValue}"</div>`);
                }
                
                if (change.isFlagged) {
                    htmlLines.push(`
                        <div style="color: var(--error)">⚠️ ${change.flagReason}</div>`);
                }
                
                htmlLines.push(`
                    </div>`);
            }

            htmlLines.push(`
                </div>
            </div>
        </div>`);
        }

        // Add search functionality
        htmlLines.push(`
    </div>
    <a href="#" class="back-to-top" id="backToTop">↑</a>
    <script>
        // Initialize column navigation
        function initializeNavigation() {
            const columnSections = document.getElementsByClassName('column-section');
            const columnButtons = document.getElementById('columnButtons');
            if (!columnButtons) return; // Exit if the container isn't found
            
            for (const section of columnSections) {
                const columnName = section.querySelector('h3').textContent;
                const flaggedCount = section.querySelectorAll('.change-item.flagged').length;
                const changedCount = section.querySelectorAll('.change-item .badge-warning').length;
                
                // Add button
                const button = document.createElement('button');
                button.className = 'nav-column-btn';
                button.onclick = () => jumpToColumn(columnName);
                
                const textSpan = document.createElement('span');
                textSpan.textContent = columnName;
                button.appendChild(textSpan);
                
                // Add badges if there are flags or changes
                if (flaggedCount > 0 || changedCount > 0) {
                    const badgeSpan = document.createElement('span');
                    if (flaggedCount > 0) {
                        badgeSpan.className = 'badge badge-error';
                        badgeSpan.textContent = flaggedCount;
                    } else if (changedCount > 0) {
                        badgeSpan.className = 'badge badge-warning';
                        badgeSpan.textContent = changedCount;
                    }
                    button.appendChild(badgeSpan);
                }
                
                columnButtons.appendChild(button);
            }
        }

        function jumpToColumn(columnName) {
            if (!columnName) return;
            
            const sections = document.getElementsByClassName('column-section');
            for (const section of sections) {
                if (section.querySelector('h3').textContent === columnName) {
                    section.scrollIntoView({ behavior: 'smooth' });
                    break;
                }
            }
        }

        function filterContent() {
            const searchText = document.getElementById('searchBox').value.toLowerCase();
            const columnSections = document.getElementsByClassName('column-section');
            
            for (const section of columnSections) {
                const sectionText = section.textContent.toLowerCase();
                let hasVisibleChanges = false;
                
                const changes = section.getElementsByClassName('change-item');
                for (const change of changes) {
                    const changeText = change.textContent.toLowerCase();
                    if (changeText.includes(searchText)) {
                        change.style.display = '';
                        hasVisibleChanges = true;
                    } else {
                        change.style.display = 'none';
                    }
                }
                
                section.style.display = hasVisibleChanges || sectionText.includes(searchText) ? '' : 'none';
            }
            
            // Show/hide no results message
            const noResults = document.getElementById('noResults');
            let hasVisibleSections = false;
            
            for (const section of columnSections) {
                if (section.style.display === '') {
                    hasVisibleSections = true;
                    break;
                }
            }
            
            noResults.style.display = hasVisibleSections ? 'none' : 'block';
        }

        // Back to top button functionality
        window.onscroll = function() {
            const backToTop = document.getElementById('backToTop');
            if (document.body.scrollTop > 500 || document.documentElement.scrollTop > 500) {
                backToTop.classList.add('visible');
            } else {
                backToTop.classList.remove('visible');
            }
        };

        // Initialize navigation when the page loads
        document.addEventListener('DOMContentLoaded', () => {
            initializeNavigation();

            const toggleNavBtn = document.getElementById('toggleNavBtn');
            const navColumns = document.getElementById('navColumns');

            if (toggleNavBtn && navColumns) {
                toggleNavBtn.addEventListener('click', () => {
                    navColumns.classList.toggle('collapsed');
                    toggleNavBtn.textContent = navColumns.classList.contains('collapsed') ? 'Show' : 'Hide';
                });
            }
        });
        
        // Initial search filter
        filterContent();
    </script>
</body>
</html>`);

        // Write HTML report
        await fsp.writeFile(htmlOutputPath, htmlLines.join('\n'), 'utf-8');
        console.log(chalk.green(`✅ Analysis report written to ${htmlOutputPath}`));
        
        // Summary
        const totalChanges = allChanges.length;
        const appliedChanges = allChanges.filter(c => c.needsChange).length;
        const flaggedCount = allChanges.filter(c => c.isFlagged).length;
        
        console.log(chalk.blue(`\n📊 REGEX VALIDATION SUMMARY:`));
        console.log(`   Columns validated: ${totalColumnsValidated}`);
        console.log(`   Total data points: ${totalDataPoints}`);
        console.log(`   Pre-cleaner:  ${preCleanerValidTotal}/${totalDataPoints} valid (${preCleanerOverallValid}%)`);
        console.log(`   Post-cleaner: ${postCleanerValidTotal}/${totalDataPoints} valid (${postCleanerOverallValid}%)`);
        console.log(`   Overall improvement: ${overallImprovement >= 0 ? '+' : ''} ${overallImprovement.toFixed(2)}%`);

        if (significantImprovements.length > 0) {
            console.log(chalk.green.bold('\n   Significant Improvements (>= 5%):'));
            significantImprovements.forEach(({ columnName, improvement }) => {
                console.log(chalk.green(`     - ${columnName}: +${improvement.toFixed(2)}%`));
            });
        }

        console.log(chalk.blue(`\n📊 CLEANER CHANGES SUMMARY:`));
        console.log(`   Total entries analyzed: ${totalChanges}`);
        console.log(`   Changes applied: ${appliedChanges}`);
        console.log(`   Flagged (failed validation): ${flaggedCount}`);
        console.log(`   Columns processed: ${Object.keys(changesByColumn).length}`);
        
        return true;
        
    } catch (error) {
        console.log(chalk.red(`❌ Error writing analysis: ${error.message}`));
        return false;
    }
}

/**
 * Create the stitched CSV by following the recommended approach
 */
async function createStitchedCsv() {
    
    // File paths
    const cleanedCsvFile = path.join(dataDir, config.data_cleaned_file_path || 'data_cleaned.csv');
    const dedupedCsvFile = path.join(dataDir, config.data_deduped_file_path || 'data_deduped.csv');
    const stitchedCsvFile = path.join(dataDir, config.data_stitched_file_path || 'data_stitched.csv');
    const columnMappingFile = path.join(outputsDir, config.outputs_column_mapping_file || 'column_mapping.json');
    const architectOutputFile = path.join(outputsDir, config.outputs_architect_output_file || 'architect_output.txt');
    
    console.log(chalk.blue('🚀 Starting stitcher process...'));
    
    // Step 1: Determine input CSV (preferring deduplicated if available)
    let inputCsvFile = cleanedCsvFile;
    let inputDescription = 'data_cleaned.csv';
    
    if (fs.existsSync(dedupedCsvFile)) {
        inputCsvFile = dedupedCsvFile;
        inputDescription = 'data_deduped.csv';
        console.log(chalk.blue('📖 Found deduplicated data, using data_deduped.csv...'));
    } else {
        console.log(chalk.blue('📖 Loading data_cleaned.csv...'));
    }
    
    let data;
    try {
        data = await readCsvFile(inputCsvFile);
        console.log(chalk.green(`✅ Loaded ${data.length} rows from ${inputDescription}`));
    } catch (error) {
        console.log(chalk.red(`❌ Error loading ${inputDescription}: ${error.message}`));
        return false;
    }
    
    // Step 2: Load column mapping and rename headers
    console.log(chalk.blue('📖 Loading column mapping...'));
    const columnMapping = loadColumnMapping(columnMappingFile);
    if (Object.keys(columnMapping).length === 0) {
        console.log(chalk.red('❌ Could not load column mapping'));
        return false;
    }
    
    console.log(chalk.blue('🔄 Analyzing column order...'));
    const dataHeaders = data.length > 0 ? Object.keys(data[0]) : [];
    console.log(chalk.blue(`📊 CSV has ${dataHeaders.length} columns`));
    console.log(chalk.blue(`📊 Mapping has ${Object.keys(columnMapping).length} entries`));
    
    // Debug: Show first few columns from CSV and mapping
    console.log(chalk.blue('\n🔍 First 5 CSV columns:'));
    for (let i = 0; i < Math.min(5, dataHeaders.length); i++) {
        console.log(`  ${i + 1}. ${dataHeaders[i]}`);
    }
    
    console.log(chalk.blue('\n🔍 First 5 mapping entries (by index):'));
    const sortedMapping = Object.entries(columnMapping).sort((a, b) => a[1].index - b[1].index);
    for (let i = 0; i < Math.min(5, sortedMapping.length); i++) {
        const [originalName, info] = sortedMapping[i];
        console.log(`  ${info.index}. ${originalName} → ${info.name} (excluded: ${info.isExcluded})`);
    }
    
    console.log(chalk.blue('\n🔄 Renaming headers using positional mapping...'));
    // Use positional mapping based on index - rename ALL columns (don't skip excluded ones)
    let renamedCount = 0;
    
    // Create mapping from old headers to new headers
    const headerMapping = {};
    
    for (const [originalHeader, columnInfo] of sortedMapping) {
        const index = columnInfo.index - 1; // Convert to 0-based
        
        if (index >= 0 && index < dataHeaders.length) {
            const actualColumn = dataHeaders[index];
            const newName = columnInfo.name;
            const isExcluded = columnInfo.isExcluded || false;
            
            if (actualColumn === originalHeader) {
                // Perfect match
                headerMapping[actualColumn] = newName;
                const status = isExcluded ? "EXCLUDED" : "INCLUDED";
                console.log(chalk.green(`  ✅ Renamed [${index + 1}] '${actualColumn}' → '${newName}' (${status})`));
                renamedCount++;
            } else {
                // Position mismatch - use position-based mapping
                console.log(chalk.yellow(`  ⚠️  Position mismatch at index ${index + 1}:`));
                console.log(`      Expected: '${originalHeader}'`);
                console.log(`      Found: '${actualColumn}'`);
                const status = isExcluded ? "EXCLUDED" : "INCLUDED";
                console.log(`      Using position-based mapping → '${newName}' (${status})`);
                headerMapping[actualColumn] = newName;
                renamedCount++;
            }
        } else {
            console.log(chalk.red(`  ❌ Index ${index + 1} out of range for column '${originalHeader}'`));
        }
    }
    
    // Apply header renaming to data
    for (const row of data) {
        for (const [oldHeader, newHeader] of Object.entries(headerMapping)) {
            if (row.hasOwnProperty(oldHeader)) {
                row[newHeader] = row[oldHeader];
                delete row[oldHeader];
            }
        }
    }
    
    console.log(chalk.green(`\n✅ Renamed ${renamedCount} columns (including excluded ones)`));
    
    // Step 3: Extract and apply architect semantic diff
    console.log(chalk.blue('📖 Extracting semantic diff from architect output...'));
    const semanticDiff = extractSemanticDiffFromArchitect(architectOutputFile);
    if (!semanticDiff) {
        console.log(chalk.red('❌ Could not extract semantic diff from architect output'));
        return false;
    }
    
    console.log(chalk.blue('🔄 Parsing architect semantic diff...'));
    const correctedRows = parseArchitectSemanticDiff(semanticDiff);
    console.log(chalk.green(`✅ Found ${Object.keys(correctedRows).length} corrected rows from architect`));
    
    // Step 4: Apply architect corrections (replace first x rows)
    console.log(chalk.blue('🔄 Applying architect corrections...'));
    let rowsUpdated = 0;
    
    const newDataHeaders = data.length > 0 ? Object.keys(data[0]) : [];
    
    for (const [rowId, correctedData] of Object.entries(correctedRows)) {
        // Convert 1-based row ID to 0-based array index
        const dataIndex = parseInt(rowId) - 1;
        
        if (dataIndex >= 0 && dataIndex < data.length) {
            // Apply corrections - architect data should match all CSV columns
            if (correctedData.length === newDataHeaders.length) {
                for (let i = 0; i < correctedData.length; i++) {
                    data[dataIndex][newDataHeaders[i]] = correctedData[i];
                }
                rowsUpdated++;
                console.log(chalk.green(`✅ Updated row ${rowId} with ${correctedData.length} values`));
            } else if (correctedData.length < newDataHeaders.length) {
                // Apply partial corrections and pad with existing values
                for (let i = 0; i < correctedData.length; i++) {
                    data[dataIndex][newDataHeaders[i]] = correctedData[i];
                }
                rowsUpdated++;
                console.log(chalk.green(`✅ Updated row ${rowId} with ${correctedData.length} values (partial)`));
            } else {
                // More corrected data than columns - truncate
                for (let i = 0; i < newDataHeaders.length; i++) {
                    data[dataIndex][newDataHeaders[i]] = correctedData[i];
                }
                rowsUpdated++;
                console.log(chalk.green(`✅ Updated row ${rowId} with ${newDataHeaders.length} values (truncated from ${correctedData.length})`));
            }
        }
    }
    
    console.log(chalk.green(`✅ Updated ${rowsUpdated} rows with architect corrections`));
    
    // Step 5: Apply cleaner changes
    console.log(chalk.blue('\n' + '='.repeat(50)));
    const cleanerSuccess = await applyCleanerChanges(data, columnMapping);
    if (!cleanerSuccess) {
        console.log(chalk.yellow('⚠️  Warning: Cleaner changes application had issues, but continuing...'));
    }
    
    // Step 6: Save the stitched CSV
    console.log(chalk.blue('💾 Saving stitched CSV...'));
    try {
        const csvContent = arrayToCsv(data);
        await fsp.writeFile(stitchedCsvFile, csvContent, 'utf-8');
        console.log(chalk.green(`✅ Stitched CSV saved to: ${stitchedCsvFile}`));
        console.log(chalk.blue(`📊 Final CSV has ${data.length} rows and ${data.length > 0 ? Object.keys(data[0]).length : 0} columns`));
        
        // Add HTML report URL at the end and open it
        const htmlOutputPath = path.join(outputsDir, config.outputs_cleaner_changes_analysis_file || 'cleaner_changes_analysis.html');
        const fileUrl = `file://${htmlOutputPath}`;
        console.log(chalk.blue(`\n🌐 Opening analysis report in your browser...`));
        console.log(chalk.cyan(fileUrl));
        
        try {
            await open(fileUrl);
            console.log(chalk.green('✅ Report opened in browser'));
        } catch (error) {
            console.log(chalk.yellow(`⚠️  Could not automatically open the report: ${error.message}`));
            console.log(chalk.yellow('   Please open the URL above manually in your browser'));
        }
        
        return true;
    } catch (error) {
        console.log(chalk.red(`❌ Error saving stitched CSV: ${error.message}`));
        return false;
    }
}

/**
 * Main function to run the stitcher process
 */
export async function main() {
    try {
        // Show configuration info
        if (config._configPath) {
            console.log(chalk.gray(`📋 Config loaded from: ${config._configPath}`));
        } else {
            console.log(chalk.yellow('📋 Using default configuration (config.json not found)'));
        }
        
        // Create output directories if they don't exist
        await fsp.mkdir(dataDir, { recursive: true });
        await fsp.mkdir(outputsDir, { recursive: true });
        
        // Run the stitching process
        const success = await createStitchedCsv();
        
        if (success) {
            console.log(chalk.green('\n🎉 Stitcher process completed successfully!'));
            return true;
        } else {
            console.log(chalk.red('\n❌ Stitcher process failed!'));
            return false;
        }
    } catch (error) {
        console.log(chalk.red(`❌ Error: ${error.message}`));
        return false;
    }
}

// CLI support
if (import.meta.url === `file://${process.argv[1]}`) {
    main().then(success => {
        process.exit(success ? 0 : 1);
    });
}
