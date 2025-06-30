# 🧹 DBClean CLI

**Transform messy CSV data into clean, standardized datasets using AI-powered automation.**

DBClean CLI is a powerful command-line tool that automatically cleans, standardizes, and restructures your CSV data using advanced AI models. Perfect for data scientists, analysts, and anyone working with messy datasets.

## 📁 Project Structure

```
dbclean-cli/
├── data/
│   ├── data.csv              # Your input file
│   ├── data_cleaned.csv      # After preclean
│   ├── data_stitched.csv     # Stitched data
│   ├── train.csv             # Training set (70%)
│   ├── validate.csv          # Validation set (15%)
│   └── test.csv              # Test set (15%)
├── settings/
│   ├── instructions.txt      # Custom AI instructions
│   └── exclude_columns.txt   # Columns to skip in preclean
├── outputs/
│   ├── architect_output.txt  # AI schema design
│   ├── column_mapping.json   # Column transformations
│   ├── cleaned_columns/      # Individual column results
│   └── cleaner_changes_analysis.txt
└── config.json              # Project configuration
```

## ✨ Features

- 🤖 **AI-Powered Cleaning** - Uses advanced language models to intelligently clean and standardize data
- 🏗️ **Schema Design** - Automatically creates optimal database schemas from your data
- 🔄 **Outlier Detection** - Uses Isolation Forest to identify and remove anomalies from your dataset.
- ✂️ **Data Splitting** - Automatically splits your cleaned data into training, validation, and test sets.
- 🔄 **Full Pipeline** - Complete automation from raw CSV to clean, structured data
- 📊 **Column-by-Column Processing** - Detailed cleaning and standardization of individual columns
- 🎯 **Model Selection** - Choose from multiple AI models for different tasks
- 📋 **Custom Instructions** - Guide the AI with your specific cleaning requirements
- 🔍 **Detailed Logging** - Track every change and transformation
- ⚡ **Batch Processing** - Handle large datasets efficiently
- 💰 **Credit-Based Billing** - Pay only for what you use with transparent pricing
- 📊 **Usage Analytics** - Track your costs and optimize your usage

## 💳 Credit System

DBClean uses a transparent, pay-as-you-go credit system:

- **Minimum Balance**: $0.01 required to make requests
- **Precision**: 4 decimal places (charges as low as $0.0001)
- **Pricing**: Based on actual Gemini AI model costs with no markup
- **Billing**: Credits deducted only after successful processing
- **Transparency**: Detailed usage tracking and cost breakdown

Check your balance anytime with `dbclean-cli credits` or get a complete overview with `dbclean-cli account`.

## 🚀 Quick Start

### Prerequisites

- **Node.js** (version 16 or higher)
- **npm** (comes with Node.js)
- A **DBClean API key** (sign up at [dbclean.dev](https://dbclean.dev))

### Installation

1. **Clone and setup the CLI:**
   ```bash
   cd dbclean-cli
   npm install
   npm link
   ```

2. **Initialize with your API credentials:**
   ```bash
   dbclean-cli init
   ```
   Enter your email and API key when prompted.

3. **Test your setup:**
   ```bash
   dbclean-cli test-auth
   dbclean-cli account
   ```

### Basic Usage

1. **Place your CSV file** in the `data/` directory as `data.csv`

2. **Run the complete pipeline:**
   ```bash
   dbclean-cli run
   ```

3. **Get your cleaned data** from `data/data_stitched.csv` 🎉

## 📖 Detailed Usage Guide

### 🔧 Setup Commands

#### Initialize CLI
```bash
dbclean-cli init
```
Set up your email and API key for authentication.

#### Test Authentication
```bash
dbclean-cli test-auth
```
Verify your credentials are working.

#### Check Status
```bash
dbclean-cli status
```
View your API key status and usage information.

#### Account Overview
```bash
dbclean-cli account
```
Complete account dashboard showing credits, usage, and status.

### 💰 Credit Management

#### Check Credit Balance
```bash
dbclean-cli credits
```
View your current credit balance and usage warnings.

#### View Usage Statistics
```bash
# Basic usage summary
dbclean-cli usage

# Detailed breakdown by service and model
dbclean-cli usage --detailed
```
Track your API usage, token consumption, and costs.

#### List Available Models
```bash
dbclean-cli models
```
See all available AI models and their pricing.

### 🔄 Pipeline Commands

#### Full Pipeline (Recommended)
```bash
# Basic full pipeline
dbclean-cli run

# With custom AI model
dbclean-cli run -m "gemini-2.5-pro"

# Different models for different steps
dbclean-cli run -ma "gemini-2.5-pro" -mc "gemini-2.5-flash"

# With custom instructions and larger sample
dbclean-cli run -i -x 10

# Skip certain steps
dbclean-cli run --skip-preclean --skip-architect --skip-isosplit
```

### 🧩 Individual Step Commands

#### 1. Preclean - Data Preparation
```bash
dbclean-cli preclean
```
Prepares your raw CSV by:
- Removing problematic newlines and special characters
- Handling non-UTF8 characters
- Creating a clean base file for AI processing

#### 2. Architect - Schema Design
```bash
# Basic schema design
dbclean-cli architect

# With specific model and larger sample
dbclean-cli architect -m "gemini-2.5-pro" -x 10

# With custom instructions
dbclean-cli architect -i

# List available models
dbclean-cli architect --list-models
```
Creates an optimized schema by:
- Analyzing your data structure
- Standardizing column names
- Defining data types and formats
- Providing cleaning examples

#### 3. Cleaner - Data Cleaning
```bash
# Clean all columns
dbclean-cli cleaner

# With specific model
dbclean-cli cleaner -m "gemini-2.5-flash"

# List available models
dbclean-cli cleaner --list-models
```
Processes each column to:
- Standardize formats and values
- Fix inconsistencies
- Flag problematic entries
- Apply schema-guided cleaning

#### 4. Stitcher - Final Assembly
```bash
dbclean-cli stitcher
```
Creates your final dataset by:
- Applying all architect corrections
- Integrating cleaner changes
- Generating final CSV with all improvements
- Creating detailed change analysis

#### 5. Isosplit - Outlier Detection & Splitting
```bash
dbclean-cli isosplit
```
Processes the stitched data to:
- Detect and remove outliers using an Isolation Forest model.
- Shuffle the cleaned data randomly.
- Split the data into `train.csv` (70%), `validate.csv` (15%), and `test.csv` (15%).

## 🎛️ Command Options

### Model Selection
- `-m <model>` - Use same model for all AI steps
- `-ma <model>` - Specific model for architect step
- `-mc <model>` - Specific model for cleaner step
- `--list-models` - Show available AI models

### Processing Options
- `-x <number>` - Sample size for architect analysis (default: 5)
- `-i` - Use custom instructions from `settings/instructions.txt`
- `--skip-preclean` - Skip data preparation step
- `--skip-architect` - Skip schema design step
- `--skip-cleaner` - Skip column cleaning step
- `--skip-dedupe` - Skip the deduplication step
- `--skip-isosplit` - Skip the outlier detection and data splitting step

### Output Options
- `--log-file <path>` - Custom log file for silent-run

## 🤖 AI Models

DBClean supports multiple AI models for different use cases:

### Recommended Models
- **gemini-2.5-pro** - Excellent for complex data understanding
- **gemini-2.5-flash** - Great general-purpose model
- **gemini-2.0-flash** - Good performance for large datasets

### Model Selection Tips
- **For complex, messy data:** Use gemini-2.5-pro
- **For speed and cost:** Use gemini-2.0-flash
- **For mixed workloads:** Use different models per step with `-ma` and `-mc`

## 📝 Custom Instructions

Create `settings/instructions.txt` to guide the AI with specific requirements:

```
Examples of custom instructions:
- "Standardize all phone numbers to E.164 format (+1XXXXXXXXXX)"
- "Convert all dates to YYYY-MM-DD format"
- "Normalize company names (remove Inc, LLC, etc.)"
- "Flag any entries with missing critical information"
```

Use with: `dbclean-cli run -i`

## 💡 Examples

### Example 1: Customer Data Cleaning
```bash
# Place customer_data.csv in data/ as data.csv
dbclean-cli run -m "gemini-2.5-pro" -i -x 15
```

### Example 2: Large Dataset (Silent Processing)
```bash
dbclean-cli silent-run -ma "gemini-2.5-pro" -mc "gemini-2.5-flash"
```

### Example 3: Quick Test (Skip Heavy Steps)
```bash
dbclean-cli run --skip-cleaner -x 3
```

### Example 4: Re-run Just Cleaning
```bash
dbclean-cli run --skip-preclean --skip-architect
```

### Example 5: Skip Outlier Detection
```bash
dbclean-cli run --skip-isosplit
```

## 🔧 Configuration

### config.json
Customize file paths and settings:
```json
{
  "data_dir": "data",
  "data_cleaned_file_path": "data_cleaned.csv",
  "data_stitched_file_path": "data_stitched.csv",
  "settings__dir": "settings",
  "outputs_dir": "outputs"
}
```

### Exclude Columns
Add column names to `settings/exclude_columns.txt` to skip them during preclean:
```
Internal_ID
Temp_Notes
Debug_Column
```

## 🎯 Best Practices

### 1. Start Small
- Begin with `-x 5` (5 rows) for initial testing
- Increase sample size for better results on complex data

### 2. Use Custom Instructions
- Provide specific formatting requirements
- Include domain knowledge about your data
- Specify any business rules or constraints

### 3. Model Selection
- Use powerful models (gemini-2.5-pro) for initial architect step
- Use faster models (gemini-2.0-flash) for repetitive cleaner tasks
- Test different combinations to find optimal performance/cost

### 4. Iterative Approach
- Run architect first to understand data structure
- Review outputs before running full pipeline
- Use skip options to re-run specific steps

## ❗ Troubleshooting

### Common Issues

**"API key not found"**
```bash
dbclean-cli init  # Re-enter credentials
dbclean-cli test-auth  # Verify connection
```

**"Data file not found"**
- Ensure `data.csv` exists in the `data/` directory
- Check file permissions and path

**"Model not available"**
```bash
dbclean-cli run --list-models  # See available models
```

**"Rate limit errors"**
- The CLI automatically retries with delays
- Use `silent-run` for unattended processing
- Consider using faster/cheaper models

### Getting Help
```bash
dbclean-cli --help           # General help
dbclean-cli run --help       # Command-specific help
dbclean-cli test            # Test console output
```

## 🤝 Support

- **Documentation:** [dbclean.dev/docs](https://dbclean.dev/docs)
- **Issues:** Report bugs or request features
- **Community:** Join our Discord for support and tips

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

---

**Ready to clean your data?** Start with `dbclean-cli init` and transform your messy CSV files into pristine datasets! 🚀