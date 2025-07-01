# 🧹 DBClean

Transform messy CSV data into clean, standardized datasets using AI-powered automation.

DBClean is a powerful command-line tool that automatically cleans, standardizes, and restructures your CSV data using advanced AI models. Perfect for data scientists, analysts, and anyone working with messy datasets.

## 📁 Project Structure

After processing, your workspace will look like this:

```
your-project/
├── data.csv                  # Your original input file
├── data/
│   ├── data_cleaned.csv      # After preclean step
│   ├── data_deduped.csv      # After duplicate removal
│   ├── data_stitched.csv     # Final cleaned dataset
│   ├── train.csv             # Training set (70%)
│   ├── validate.csv          # Validation set (15%)
│   └── test.csv              # Test set (15%)
├── settings/
│   ├── instructions.txt      # Custom AI instructions
│   └── exclude_columns.txt   # Columns to skip in preclean
└── outputs/
    ├── architect_output.txt  # AI schema design
    ├── column_mapping.json   # Column transformations
    ├── cleaned_columns/      # Individual column results
    ├── cleaner_changes_analysis.html
    └── dedupe_report.txt
```

## ✨ Features

- **🤖 AI-Powered Cleaning** - Uses advanced language models to intelligently clean and standardize data
- **🏗️ Schema Design** - Automatically creates optimal database schemas from your data
- **🔍 Duplicate Detection** - AI-powered duplicate identification and removal
- **🎯 Outlier Detection** - Uses Isolation Forest to identify and remove anomalies
- **✂️ Data Splitting** - Automatically splits cleaned data into training, validation, and test sets
- **🔄 Full Pipeline** - Complete automation from raw CSV to clean, structured data
- **📊 Column-by-Column Processing** - Detailed cleaning and standardization of individual columns
- **🎯 Model Selection** - Choose from multiple AI models for different tasks
- **📋 Custom Instructions** - Guide the AI with your specific cleaning requirements
- **💰 Credit-Based Billing** - Pay only for what you use with transparent pricing

## 💳 Credit System

DBClean uses a transparent, pay-as-you-go credit system.

- **Free Tier**: 5 free requests per month for new users
- **Minimum Balance**: $0.01 required for paid requests
- **Precision**: 4 decimal places (charges as low as $0.0001)
- **Pricing**: Based on actual AI model costs with no markup
- **Billing**: Credits deducted only after successful processing

Check your balance anytime with `dbclean credits` or get a complete overview with `dbclean account`.

## 🚀 Quick Start

### 1. Install DBClean

```bash
npm install -g @dbclean/cli
```

### 2. Initialize Your Account

```bash
dbclean init
```

Enter your email and API key when prompted. Don't have an account? Sign up at [dbclean.dev](https://dbclean.dev)

### 3. Verify Setup

```bash
dbclean test-auth
dbclean account
```

### 4. Process Your Data

```bash
# Place your CSV file as data.csv in your current directory
dbclean run
```

Your cleaned data will be available in `data/data_stitched.csv` 🎉

## 📖 Command Reference

### 🔧 Setup & Authentication

| Command | Description |
|---------|-------------|
| `dbclean init` | Initialize with your email and API key |
| `dbclean test-auth` | Verify your credentials are working |
| `dbclean logout` | Remove stored credentials |
| `dbclean status` | Check API key status and account info |

### 💰 Account Management

| Command | Description |
|---------|-------------|
| `dbclean account` | Complete account overview (credits, usage, status) |
| `dbclean credits` | Check your current credit balance |
| `dbclean usage` | View API usage statistics |
| `dbclean usage --detailed` | Detailed breakdown by service and model |
| `dbclean models` | List all available AI models |

### 📊 Data Processing Pipeline

| Command | Description |
|---------|-------------|
| `dbclean run` | **Execute complete pipeline** (recommended) |
| `dbclean preclean` | Clean CSV data (remove newlines, special chars) |
| `dbclean architect` | AI-powered schema design and standardization |
| `dbclean dedupe` | AI-powered duplicate detection and removal |
| `dbclean cleaner` | AI-powered column-by-column data cleaning |
| `dbclean stitcher` | Combine all changes into final CSV |
| `dbclean isosplit` | Detect outliers and split into train/validate/test |

## 🔄 Complete Pipeline

The recommended approach is to use the full pipeline with `dbclean run`.

```bash
# Basic full pipeline
dbclean run

# With custom AI model
dbclean run -m "gemini-2.0-flash-exp"

# Different models for different steps
dbclean run --model-architect "gemini-2.0-flash-thinking" --model-cleaner "gemini-2.0-flash-exp"

# With custom instructions and larger sample
dbclean run -i -x 10

# Skip certain steps
dbclean run --skip-preclean --skip-dedupe
```

### Pipeline Steps

1. **Preclean** - Prepares raw CSV by removing problematic characters and formatting
2. **Architect** - AI analyzes your data structure and creates optimized schema
3. **Dedupe** - AI identifies and removes duplicate records intelligently
4. **Cleaner** - AI processes each column to standardize and clean data
5. **Stitcher** - Combines all improvements into final dataset
6. **Isosplit** - Removes outliers and splits data for machine learning

## 🎛️ Command Options

### Model Selection

- `-m <model>` - Use same model for all AI steps
- `--model-architect <model>` - Specific model for architect step
- `--model-cleaner <model>` - Specific model for cleaner step

### Processing Options

- `-x <number>` - Sample size for architect analysis (default: 5)
- `-i` - Use custom instructions from `settings/instructions.txt`
- `--input <file>` - Specify input CSV file (default: data.csv)

### Skip Options

- `--skip-preclean` - Skip data preparation step
- `--skip-architect` - Skip schema design step
- `--skip-dedupe` - Skip duplicate detection step
- `--skip-cleaner` - Skip column cleaning step
- `--skip-isosplit` - Skip outlier detection and data splitting

## 🤖 AI Models

### Recommended Models

| Model | Best For | Speed | Cost |
|-------|----------|-------|------|
| `gemini-2.0-flash-exp` | General purpose, fast processing | ⚡⚡⚡ | 💲 |
| `gemini-2.0-flash-thinking` | Complex data analysis | ⚡⚡ | 💲💲 |
| `gemini-1.5-pro` | Large, complex datasets | ⚡ | 💲💲💲 |

### Model Selection Tips

- **For speed and cost:** Use `gemini-2.0-flash-exp`
- **For complex, messy data:** Use `gemini-2.0-flash-thinking` for architect
- **For mixed workloads:** Use different models per step with `--model-architect` and `--model-cleaner`

```bash
# List all available models
dbclean models
```

## 📝 Custom Instructions

Create custom cleaning instructions to guide the AI.

1. **For architect step:** Use the `-i` flag with a `settings/instructions.txt` file.
2. **Example instructions:**

```txt
- Standardize all phone numbers to E.164 format (+1XXXXXXXXXX)
- Convert all dates to YYYY-MM-DD format
- Normalize company names (remove Inc, LLC, etc.)
- Flag any entries with missing critical information
- Ensure email addresses are properly formatted
```

```bash
dbclean run -i  # Uses instructions from settings/instructions.txt
```

## 💡 Usage Examples

### Basic Processing

```bash
# Process a CSV file with default settings
dbclean run

# Use a specific input file
dbclean run --input customer_data.csv
```

### Advanced Processing

```bash
# High-quality processing with larger sample
dbclean run -m "gemini-2.0-flash-thinking" -x 15 -i

# Fast processing for large datasets
dbclean run -m "gemini-2.0-flash-exp" --skip-dedupe

# Custom pipeline - architect only
dbclean run --skip-preclean --skip-cleaner --skip-dedupe --skip-isosplit
```

### Individual Steps

```bash
# Run architect with custom model and sample size
dbclean architect -m "gemini-2.0-flash-thinking" -x 10 -i

# Clean data with specific model
dbclean cleaner -m "gemini-2.0-flash-exp"

# Remove duplicates with AI analysis
dbclean dedupe
```

## 🎯 Best Practices

### 1. Start Small and Iterate

```bash
# Test with small sample first
dbclean architect -x 3

# Review outputs, then run full pipeline
dbclean run
```

### 2. Choose the Right Models

```bash
# For complex schema design
dbclean run --model-architect "gemini-2.0-flash-thinking" --model-cleaner "gemini-2.0-flash-exp"
```

### 3. Use Custom Instructions

Create `settings/instructions.txt` with domain-specific requirements:

```txt
Finance data requirements:
- Currency amounts in USD format ($X,XXX.XX)
- Account numbers must be 10-12 digits
- Transaction dates in YYYY-MM-DD format
```

### 4. Monitor Your Usage

```bash
# Check account status regularly
dbclean account

# Monitor detailed usage
dbclean usage --detailed
```

## ❗ Troubleshooting

### Common Issues

#### Authentication Problems

```bash
dbclean init     # Re-enter credentials
dbclean test-auth # Verify connection
```

#### Data File Issues

- Ensure `data.csv` exists in current directory
- Use `--input <file>` for different file names
- Check file permissions and encoding

#### API Limits

- Check credit balance: `dbclean credits`
- View usage: `dbclean usage`
- Free tier: 5 requests per month, then paid credits required

#### Model Availability

```bash
dbclean models   # See available models
```

### Getting Help

```bash
dbclean --help              # General help
dbclean run --help          # Command-specific help
dbclean help-commands       # Detailed command reference
```

## 📊 Output Files

After processing, you'll have:

- `data/data_stitched.csv` - Your final, cleaned dataset
- `data/train.csv` - Training data (70%)
- `data/validate.csv` - Validation data (15%)
- `data/test.csv` - Test data (15%)
- `outputs/cleaner_changes_analysis.html` - Visual changes report
- `outputs/architect_output.txt` - AI schema analysis
- `outputs/column_mapping.json` - Column transformation details

## 🤝 Support

- [Documentation](https://dbclean.dev/docs)
- [Support](https://dbclean.dev/support)
- API Status: Check real-time status and get your API key

## License

This project is licensed under the MIT License - see the LICENSE file for details.

**Ready to clean your data?** Start with `dbclean init` and transform your messy CSV files into pristine datasets! 🚀
