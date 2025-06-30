# 🧹 DBClean API

Transform messy CSV data into clean, standardized datasets using advanced AI models. Perfect for data scientists, analysts, and developers working with data pipelines.

## Step 1: Get Your API Key 🔑

**Prerequisites**
- Sign up at [dbclean.dev](https://dbclean.dev)
- Navigate to your account dashboard
- Generate your API key

**💰 Credit System**
Usage-based pricing where the number of credits you buy are equal to the dollars you can spend on tokens.

## Step 2: Install CLI & Configure 🚀

**Install the CLI**
Open your terminal and run the following command to install the DBClean CLI:

```bash
npm install dbclean-cli
```

**Configure File Paths**
After installation, a `config.json` file for all the relevant paths is created and needs to be setup according to your paths. Here is an example configuration:

```json
{
    "settings__dir": "settings",
    "settings_exclude_columns_file_path": "exclude_columns.txt",
    "settings_instructions_file_path": "instructions.txt",
    "data_dir": "data",
    "data_cleaned_file_path": "data_cleaned.csv",
    "data_deduped_file_path": "data_deduped.csv",
    "data_stitched_file_path": "data_stitched.csv",
    "outputs_dir": "outputs",
    "outputs_cleaned_columns_dir": "cleaned_columns",
    "outputs_architect_output_file": "architect_output.txt",
    "outputs_cleaner_changes_analysis_file": "cleaner_changes_analysis.html",
    "outputs_column_mapping_file": "column_mapping.json"
}
```

## Step 3: Understanding the Services ✨

DBClean provides five powerful services that work together to transform your messy data into pristine datasets

### ✨ Preclean
Prepares your raw CSV for AI processing
- Removes problematic newlines and special characters
- Handles non-UTF8 characters
- Creates clean base file for AI processing

### 🏗️ Architect
Analyzes your CSV data and creates an optimal schema
- Understands data structure and types
- Standardizes column names
- Provides cleaning recommendations
- Creates database-ready schemas

### 🤖 Cleaner
Cleans and standardizes individual columns of data
- Fixes inconsistencies and errors
- Standardizes formats
- Handles missing values
- Applies domain-specific rules

### 🧩 Stitcher
Assembles your final cleaned dataset
- Applies all architect corrections
- Integrates cleaner changes
- Generates final CSV with improvements
- Creates detailed change analysis

### 📊 Isosplit
Outlier detection and data splitting for ML
- Uses Isolation Forest to detect outliers
- Shuffles cleaned data randomly
- Splits into train (70%), validate (15%), test (15%)

## Step 4: Full Workflow (via CLI) 🚀

For power users, the DBClean CLI provides a command-based workflow to run the entire pipeline from your terminal.

**The 5 Steps of Data Cleaning**
From raw data to a clean, split dataset ready for machine learning.

**1. Preclean**
Prepares your raw CSV by removing problematic newlines, special characters, and handling non-UTF8 characters.
```bash
dbclean-cli preclean
```

**2. Architect**
Analyzes your data structure, standardizes column names, defines data types, and provides cleaning examples.
```bash
# Basic schema design
dbclean-cli architect

# With specific model and larger sample
dbclean-cli architect -m "gemini-2.5-pro" -x 10
```

**3. Cleaner**
Processes each column to standardize formats, fix inconsistencies, and apply schema-guided cleaning.
```bash
# Clean all columns
dbclean-cli cleaner

# With specific model
dbclean-cli cleaner -m "gemini-2.5-flash"
```

**4. Stitcher**
Creates your final dataset by applying all architect corrections and integrating cleaner changes.
```bash
dbclean-cli stitcher
```

**5. Isosplit**
Detects and removes outliers using an Isolation Forest model, then shuffles and splits the data into train (70%), validate (15%), and test (15%) sets.
```bash
dbclean-cli isosplit
```

## AI Models & Selection 🤖

Choose the perfect AI model for your specific data cleaning needs

**gemini-2.5-pro**
Best for complex data analysis and schema design
- Recommended for Architect service
- Handles complex, messy datasets
- Higher cost, better quality

**gemini-2.5-flash**
Great balance of speed and quality
- Recommended for Cleaner service
- Good for most use cases
- Balanced cost and performance

**gemini-2.0-flash**
Fast and cost-effective
- Good for large datasets
- Simple data cleaning tasks
- Lowest cost option

## API Reference 📚

Complete endpoint documentation for seamless integration

### AI Services
- **POST** `/api/architect/process` - Schema Design
- **POST** `/api/cleaner/process` - Data Cleaning
- **POST** `/api/dedupe/process` - Duplicate Detection

### Account & Usage
- **GET** `/api/credits` - Balance
- **GET** `/api/usage` - Statistics
- **GET** `/api/models` - Available Models 
