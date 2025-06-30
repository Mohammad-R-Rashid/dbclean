#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import Conf from 'conf';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { cleanCSV } from './src/preclean.js';
import { main as runArchitect, createColumnMapping, getAvailableModels } from './src/architect.js';
import { main as runDedupe } from './src/dedupe.js';
import { main as runCleaner } from './src/cleaner.js';
import { main as runStitcher } from './src/stitcher.js';
import { main as runIsosplit } from './src/isosplit.js';

const projectName = 'dbclean-cli';
const program = new Command();
const config = new Conf({ projectName: projectName });

// API Configuration
const API_BASE_URL = 'https://dbclean-api.dbcleandev.workers.dev';

// Load configuration from config.json
function loadAppConfig() {
    try {
        // Find the package's config.json (bundled with npm package)
        const packageConfigPath = path.join(path.dirname(import.meta.url.replace('file://', '')), 'config.json');
        
        if (fs.existsSync(packageConfigPath)) {
            const configContent = fs.readFileSync(packageConfigPath, 'utf-8');
            const config = JSON.parse(configContent);
            // Store package directory for settings files
            config._packageDir = path.dirname(packageConfigPath);
            return config;
        }
        
        throw new Error('config.json not found in package');
    } catch (error) {
        console.log(`⚠️  Warning: Could not load config.json: ${error.message}`);
        // Return default values if config.json doesn't exist
        return {
            settings__dir: "settings",
            settings_exclude_columns_file_path: "exclude_columns.txt",
            settings_instructions_file_path: "instructions.txt",
            data_dir: "data",
            data_cleaned_file_path: "data_cleaned.csv",
            data_deduped_file_path: "data_deduped.csv",
            data_stitched_file_path: "data_stitched.csv",
            outputs_dir: "outputs",
            outputs_cleaned_columns_dir: "cleaned_columns",
            outputs_architect_output_file: "architect_output.txt",
            outputs_cleaner_changes_analysis_file: "cleaner_changes_analysis.html",
            outputs_column_mapping_file: "column_mapping.json"
        };
    }
}

const appConfig = loadAppConfig();

program
  .name(projectName)
  .description('A CLI tool for the DBClean API with credit-based AI processing')
  .version('1.0.0');

// Enhanced help command
program
  .command('help-commands')
  .description('Show detailed help for all available commands')
  .action(() => {
    console.log(chalk.bold.blue('\n🚀 DBClean CLI - Complete Command Reference\n'));
    
    console.log(chalk.bold.cyan('🔧 Setup & Authentication:'));
    console.log(chalk.yellow('  init') + chalk.gray('                  Initialize CLI with email and API key'));
    console.log(chalk.yellow('  logout') + chalk.gray('                Remove your stored email and API key'));
    console.log(chalk.yellow('  test-auth') + chalk.gray('             Test if your API credentials are valid'));
    console.log(chalk.yellow('  status') + chalk.gray('                Check API key status and account info'));
    console.log('');
    
    console.log(chalk.bold.cyan('💰 Credit Management:'));
    console.log(chalk.yellow('  account') + chalk.gray('               Complete account overview (credits, usage, status)'));
    console.log(chalk.yellow('  credits') + chalk.gray('               Check your current credit balance'));
    console.log(chalk.yellow('  usage') + chalk.gray('                 View API usage statistics and history'));
    console.log(chalk.yellow('  usage --detailed') + chalk.gray('      Show detailed breakdown by service and model'));
    console.log('');
    
    console.log(chalk.bold.cyan('🤖 AI Models:'));
    console.log(chalk.yellow('  models') + chalk.gray('                List all available AI models'));
    console.log('');
    
    console.log(chalk.bold.cyan('📊 Data Processing Pipeline:'));
    console.log(chalk.yellow('  preclean') + chalk.gray('              Clean CSV data (remove newlines, special chars)'));
    console.log(chalk.yellow('  architect') + chalk.gray('             AI-powered schema design and standardization'));
    console.log(chalk.yellow('  dedupe') + chalk.gray('                AI-powered duplicate detection and removal'));
    console.log(chalk.yellow('  cleaner') + chalk.gray('               AI-powered column-by-column data cleaning'));
    console.log(chalk.yellow('  stitcher') + chalk.gray('              Combine all changes into final CSV'));
    console.log(chalk.yellow('  isosplit') + chalk.gray('              Detect outliers and split data into train/validate/test sets'));
    console.log(chalk.yellow('  run') + chalk.gray('                   Execute complete pipeline (all steps)'));
    console.log('');
    
    console.log(chalk.bold.cyan('🎨 Utilities:'));
    console.log(chalk.yellow('  test') + chalk.gray('                  Test console output (colors, spinners)'));
    console.log(chalk.yellow('  help-commands') + chalk.gray('         Show this detailed help'));
    console.log('');
    
    console.log(chalk.bold.green('📋 Quick Start Guide:'));
    console.log(chalk.gray('  1. ') + chalk.cyan('dbclean-cli init') + chalk.gray('                    # Set up credentials'));
    console.log(chalk.gray('  2. ') + chalk.cyan('dbclean-cli account') + chalk.gray('                  # Check account overview'));
    console.log(chalk.gray('  3. ') + chalk.cyan('dbclean-cli models') + chalk.gray('                   # See available AI models'));
    console.log(chalk.gray('  4. ') + chalk.cyan('dbclean-cli run --input data.csv') + chalk.gray('        # Process your CSV file'));
    console.log('');
    
    console.log(chalk.bold.yellow('💡 Advanced Options:'));
    console.log(chalk.gray('  • Use ') + chalk.cyan('--input <file>') + chalk.gray(' to specify input CSV file'));
    console.log(chalk.gray('  • Use ') + chalk.cyan('--model <n>') + chalk.gray(' to specify AI model'));
    console.log(chalk.gray('  • Use ') + chalk.cyan('--instructions') + chalk.gray(' to apply custom cleaning rules'));
    console.log(chalk.gray('  • Use ') + chalk.cyan('--sample-size <n>') + chalk.gray(' for architect processing'));
    console.log(chalk.gray('  • Use ') + chalk.cyan('--detailed') + chalk.gray(' for comprehensive usage reports'));
    console.log('');
    
    console.log(chalk.cyan('For specific command help: ') + chalk.yellow('dbclean-cli <command> --help'));
    console.log('');
  });

// Initialize with email and API key
program
  .command('init')
  .description('Initialize CLI with your email and API key')
  .option('-e, --email <email>', 'Your email address')
  .option('-k, --key <key>', 'Your API key')
  .action(async (options) => {
    let email = options.email;
    let apiKey = options.key;

    // If not provided via options, prompt for them
    if (!email) {
      const { default: inquirer } = await import('inquirer');
      const emailAnswer = await inquirer.prompt([
        {
          type: 'input',
          name: 'email',
          message: 'Enter your email address:',
          validate: (input) => {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            return emailRegex.test(input) || 'Please enter a valid email address';
          }
        }
      ]);
      email = emailAnswer.email;
    }

    if (!apiKey) {
      const { default: inquirer } = await import('inquirer');
      const keyAnswer = await inquirer.prompt([
        {
          type: 'password',
          name: 'apiKey',
          message: 'Enter your API key:',
          mask: '*',
          validate: (input) => input.length > 0 || 'API key cannot be empty'
        }
      ]);
      apiKey = keyAnswer.apiKey;
    }

    const spinner = ora('Verifying credentials...').start();
    try {
      const response = await axios.post(`${API_BASE_URL}/api/keys/authenticate`, {
        email: email,
        apiKey: apiKey
      }, {
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.data.authenticated) {
        spinner.succeed(chalk.green('✅ Authentication successful!'));
        
        config.set('email', email);
        config.set('apiKey', apiKey);
        
        console.log(chalk.green('✅ Configuration saved successfully!'));
        console.log(chalk.cyan(`📧 Email: ${email}`));
        console.log(chalk.cyan(`🔑 API Key: ${'*'.repeat(8)}...${apiKey.slice(-4)}`));
      } else {
        spinner.fail(chalk.red('❌ Authentication failed.'));
        console.log(chalk.red(response.data.error || 'Invalid credentials. Configuration not saved.'));
      }
    } catch (err) {
      spinner.fail('Authentication request failed.');
      if (err.response?.status === 401) {
        console.error(chalk.red('❌ Invalid API key or email. Configuration not saved.'));
      } else {
        console.error(chalk.red(err?.response?.data?.error || err.message));
        console.log(chalk.yellow('Could not connect to the API. Configuration not saved.'));
      }
    }
  });

// Logout
program
  .command('logout')
  .description('Remove your stored email and API key from the configuration')
  .action(() => {
    const email = config.get('email');
    if (email) {
      config.delete('email');
      config.delete('apiKey');
      console.log(chalk.green('✅ Successfully logged out.'));
      console.log(chalk.gray('Your credentials have been removed from the configuration.'));
    } else {
      console.log(chalk.yellow('You are not logged in.'));
    }
  });
  
  // Preclean CSV data
  program
    .command('preclean')
    .description('Clean CSV data by removing newlines, replacing special characters, and handling non-UTF8 chars')
    .option('--input <path>', `Input CSV file path (default: data.csv)`)
    .option('--output <path>', `Output CSV file path (default: ${appConfig.data_cleaned_file_path})`)
    .option('--exclude <path>', `Path to text file containing column names to exclude from cleaning (default: use bundled exclude file)`)
    .action(async (options) => {
      const spinner = ora('Processing CSV cleaning...').start();
      
      try {
        // Use current working directory for data files
        const workingDir = process.cwd();
        // Create data and outputs directories if they don't exist
        const dataDir = path.join(workingDir, appConfig.data_dir || 'data');
        const outputsDir = path.join(workingDir, appConfig.outputs_dir || 'outputs');
        
        // Ensure directories exist
        if (!fs.existsSync(dataDir)) {
          fs.mkdirSync(dataDir, { recursive: true });
        }
        if (!fs.existsSync(outputsDir)) {
          fs.mkdirSync(outputsDir, { recursive: true });
        }
        
        // Use package directory for settings files
        const packageSettingsDir = appConfig._packageDir ? 
          path.join(appConfig._packageDir, appConfig.settings__dir || 'settings') :
          path.join(path.dirname(import.meta.url.replace('file://', '')), appConfig.settings__dir || 'settings');
        
        const originalCsvPath = options.input || path.join(workingDir, 'data.csv');
        const cleanedCsvPath = options.output || path.join(dataDir, appConfig.data_cleaned_file_path || 'data_cleaned.csv');
        const excludeFilePath = options.exclude || path.join(packageSettingsDir, appConfig.settings_exclude_columns_file_path || 'exclude_columns.txt');
        
        // Debug output
        console.log(chalk.gray(`📂 Working directory: ${workingDir}`));
        console.log(chalk.gray(`📂 Data directory: ${dataDir}`));
        console.log(chalk.gray(`⚙️  Package settings directory: ${packageSettingsDir}`));

        // Check if input file exists
        if (!fs.existsSync(originalCsvPath)) {
          spinner.fail(chalk.red(`❌ Input CSV file not found: ${originalCsvPath}`));
          console.log(chalk.cyan(`🔍 Full path checked: ${path.resolve(originalCsvPath)}`));
          console.log(chalk.cyan(`📁 Current working directory: ${process.cwd()}`));
          console.log(chalk.yellow("Please ensure your CSV file exists in the current directory or specify --input <file>."));
          return;
        }

        spinner.text = 'Cleaning CSV data...';
        
        const cleanedPath = await cleanCSV(originalCsvPath, cleanedCsvPath, excludeFilePath);

        if (cleanedPath) {
          spinner.succeed(chalk.green('✅ Successfully cleaned CSV data!'));
          console.log(chalk.cyan(`📁 Original file (unchanged): ${originalCsvPath}`));
          console.log(chalk.cyan(`📁 Cleaned file (new): ${cleanedPath}`));
          console.log(chalk.gray("\n🔄 You can now run other processing commands with the cleaned data."));
        } else {
          spinner.fail(chalk.red('❌ Failed to clean CSV data'));
        }
      } catch (error) {
        spinner.fail(chalk.red('❌ Error during CSV cleaning'));
        console.error(chalk.red(error.message));
      }
    });

  // Test authentication
program
  .command('test-auth')
  .description('Test if your API key and email are valid')
  .action(async () => {
    const email = config.get('email');
    const apiKey = config.get('apiKey');
    
    if (!email || !apiKey) {
      console.log(chalk.red('❌ Please run `dbclean-cli init` first to set your email and API key'));
      return;
    }

    const spinner = ora('Testing authentication...').start();
    try {
      const response = await axios.post(`${API_BASE_URL}/api/keys/authenticate`, {
        email: email,
        apiKey: apiKey
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.data.authenticated) {
        spinner.succeed(chalk.green('✅ Authentication successful!'));
        console.log(chalk.cyan(`📧 Email: ${email}`));
        console.log(chalk.green('🔑 Your API key is valid and active'));
      } else {
        spinner.fail(chalk.red('❌ Authentication failed'));
        console.log(chalk.red(response.data.error || 'Invalid credentials'));
      }
    } catch (err) {
      spinner.fail('Failed to test authentication');
      if (err.response?.status === 401) {
        console.error(chalk.red('❌ Invalid API key or email'));
      } else {
        console.error(chalk.red(err?.response?.data?.error || err.message));
      }
    }
  });

// Check credit balance
program
  .command('credits')
  .description('Check your current credit balance')
  .action(async () => {
    const email = config.get('email');
    const apiKey = config.get('apiKey');
    
    if (!email || !apiKey) {
      console.log(chalk.red('❌ Please run `dbclean-cli init` first to set your email and API key'));
      return;
    }

    const spinner = ora('Fetching credit balance...').start();
    try {
      const response = await axios.get(`${API_BASE_URL}/api/credits`, {
        headers: {
          'X-Email': email,
          'X-API-Key': apiKey,
          'Content-Type': 'application/json'
        }
      });

      const credits = response.data.credits || 0;
      spinner.succeed(chalk.green('✅ Credit balance retrieved'));
      
      console.log(chalk.bold.blue('\n💰 Credit Balance Report\n'));
      console.log(chalk.cyan(`📧 Email: ${email}`));
      console.log(chalk.green(`💳 Current Balance: $${credits.toFixed(4)}`));
      
      if (credits < 0.01) {
        console.log(chalk.red('\n⚠️  Low Balance Warning'));
        console.log(chalk.yellow('You need at least $0.01 to make API requests.'));
        console.log(chalk.cyan('Please add credits to your account to continue using the service.'));
      } else if (credits < 1.00) {
        console.log(chalk.yellow('\n💡 Balance Notice'));
        console.log(chalk.gray(`You have $${credits.toFixed(4)} remaining.`));
        console.log(chalk.gray('Consider adding more credits for extended usage.'));
      } else {
        console.log(chalk.green('\n✅ Good Balance'));
        console.log(chalk.gray('You have sufficient credits for API requests.'));
      }
      
      console.log(''); // Empty line for spacing
      
    } catch (err) {
      spinner.fail('Failed to fetch credit balance');
      if (err.response?.status === 401) {
        console.error(chalk.red('❌ Invalid API key or email'));
      } else {
        console.error(chalk.red(err?.response?.data?.error || err.message));
      }
    }
  });

// List available AI models
program
  .command('models')
  .description('List available AI models for processing')
  .action(async () => {
    const spinner = ora('Fetching available AI models...').start();
    try {
      const response = await axios.get(`${API_BASE_URL}/api/models`, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const models = response.data.models || [];
      if (models.length > 0) {
        spinner.succeed(chalk.green('✅ Available AI models retrieved'));
        
        console.log(chalk.bold.blue('\n🤖 Available AI Models\n'));
        models.forEach((model, index) => {
          console.log(chalk.cyan(`  ${index + 1}. ${model}`));
        });
        
        console.log(chalk.gray('\n💡 Use these model names with the --model or --model-architect/--model-cleaner options'));
        console.log(chalk.gray('Example: dbclean-cli architect --model "anthropic/claude-3.5-haiku"'));
      } else {
        spinner.fail(chalk.red('❌ No models available'));
      }
      
      console.log(''); // Empty line for spacing
      
    } catch (err) {
      spinner.fail('Failed to fetch available models');
      console.error(chalk.red(err?.response?.data?.error || err.message));
    }
  });

// View usage statistics
program
  .command('usage')
  .description('View your API usage statistics and history')
  .option('--detailed', 'Show detailed usage breakdown by service and model')
  .action(async (options) => {
    const email = config.get('email');
    const apiKey = config.get('apiKey');
    
    if (!email || !apiKey) {
      console.log(chalk.red('❌ Please run `dbclean-cli init` first to set your email and API key'));
      return;
    }

    const spinner = ora('Fetching usage statistics...').start();
    try {
      const response = await axios.get(`${API_BASE_URL}/api/usage`, {
        headers: {
          'X-Email': email,
          'X-API-Key': apiKey,
          'Content-Type': 'application/json'
        }
      });

      const usage = response.data.usage;
      spinner.succeed(chalk.green('✅ Usage statistics retrieved'));
      
      console.log(chalk.bold.blue('\n📊 API Usage Statistics\n'));
      console.log(chalk.cyan(`📧 Email: ${email}`));
      
      // Total usage summary
      if (usage.total) {
        console.log(chalk.bold.green('\n📈 Total Usage Summary'));
        console.log(chalk.gray(`   • Total Requests: ${usage.total.total_requests || 0}`));
        console.log(chalk.gray(`   • Input Tokens: ${(usage.total.total_input_tokens || 0).toLocaleString()}`));
        console.log(chalk.gray(`   • Output Tokens: ${(usage.total.total_output_tokens || 0).toLocaleString()}`));
        console.log(chalk.gray(`   • Total Tokens: ${(usage.total.total_tokens || 0).toLocaleString()}`));
        if (usage.total.total_cost_usd !== null && usage.total.total_cost_usd !== undefined) {
          console.log(chalk.gray(`   • Total Cost: $${(usage.total.total_cost_usd || 0).toFixed(4)}`));
        }

        // Count free requests this month
        const freeRequests = usage.byService?.filter(s => s.key_type === 'free' && 
          new Date(s.created_at).getMonth() === new Date().getMonth() &&
          new Date(s.created_at).getFullYear() === new Date().getFullYear()
        ).length || 0;

        console.log(chalk.yellow(`   • Free Requests This Month: ${freeRequests}/5`));
        if (freeRequests >= 5) {
          console.log(chalk.red('   ⚠️  Monthly free request limit reached'));
        } else {
          console.log(chalk.green(`   ✅ ${5 - freeRequests} free requests remaining this month`));
        }
      }

      // Detailed breakdown if requested
      if (options.detailed) {
        // Usage by service
        if (usage.byService && usage.byService.length > 0) {
          console.log(chalk.bold.cyan('\n🔧 Usage by Service'));
          usage.byService.forEach(service => {
            console.log(chalk.yellow(`\n   ${service.service.toUpperCase()} - ${service.request_type}`));
            console.log(chalk.gray(`      • Requests: ${service.requests}`));
            console.log(chalk.gray(`      • Input Tokens: ${service.input_tokens.toLocaleString()}`));
            console.log(chalk.gray(`      • Output Tokens: ${service.output_tokens.toLocaleString()}`));
            console.log(chalk.gray(`      • Total Tokens: ${service.total_tokens.toLocaleString()}`));
            if (service.cost_usd !== null && service.cost_usd !== undefined) {
              console.log(chalk.gray(`      • Cost: $${service.cost_usd.toFixed(4)}`));
            }
          });
        }

        // Usage by model
        if (usage.byModel && usage.byModel.length > 0) {
          console.log(chalk.bold.magenta('\n🤖 Usage by Model'));
          usage.byModel.forEach(model => {
            console.log(chalk.yellow(`\n   ${model.model}`));
            console.log(chalk.gray(`      • Requests: ${model.requests}`));
            console.log(chalk.gray(`      • Input Tokens: ${model.input_tokens.toLocaleString()}`));
            console.log(chalk.gray(`      • Output Tokens: ${model.output_tokens.toLocaleString()}`));
            console.log(chalk.gray(`      • Total Tokens: ${model.total_tokens.toLocaleString()}`));
            if (model.cost_usd !== null && model.cost_usd !== undefined) {
              console.log(chalk.gray(`      • Cost: $${model.cost_usd.toFixed(4)}`));
            }
          });
        }
      }

      // Recent usage (last 30 days)
      if (usage.recent && usage.recent.length > 0) {
        console.log(chalk.bold.blue('\n📅 Recent Usage (Last 30 Days)'));
        const recentSorted = usage.recent.slice(0, 10); // Show last 10 days
        recentSorted.forEach(day => {
          console.log(chalk.gray(`   ${day.date}: ${day.requests} requests, ${day.tokens_used.toLocaleString()} tokens${day.cost_usd ? `, $${day.cost_usd.toFixed(4)}` : ''}`));
        });
        if (usage.recent.length > 10) {
          console.log(chalk.gray(`   ... and ${usage.recent.length - 10} more days`));
        }
      }
      
      console.log(chalk.gray('\n💡 Use --detailed flag for complete breakdown by service and model'));
      console.log(''); // Empty line for spacing
      
    } catch (err) {
      spinner.fail('Failed to fetch usage statistics');
      if (err.response?.status === 401) {
        console.error(chalk.red('❌ Invalid API key or email'));
      } else {
        console.error(chalk.red(err?.response?.data?.error || err.message));
      }
    }
  });

// Account overview - Combined credits, usage, and status
program
  .command('account')
  .description('Show complete account overview (credits, usage, status)')
  .action(async () => {
    const email = config.get('email');
    const apiKey = config.get('apiKey');
    
    if (!email || !apiKey) {
      console.log(chalk.red('❌ Please run `dbclean-cli init` first to set your email and API key'));
      return;
    }

    console.log(chalk.bold.blue('\n📋 DBClean Account Overview\n'));
    console.log(chalk.cyan(`📧 Account: ${email}`));
    console.log('');

    // Fetch all data in parallel
    const spinner = ora('Fetching account information...').start();
    try {
      const [creditsResponse, usageResponse, statusResponse] = await Promise.all([
        axios.get(`${API_BASE_URL}/api/credits`, {
          headers: { 'X-Email': email, 'X-API-Key': apiKey, 'Content-Type': 'application/json' }
        }),
        axios.get(`${API_BASE_URL}/api/usage`, {
          headers: { 'X-Email': email, 'X-API-Key': apiKey, 'Content-Type': 'application/json' }
        }),
        axios.get(`${API_BASE_URL}/api/keys/status`, {
          params: { email: email },
          headers: { 'Content-Type': 'application/json' }
        })
      ]);

      spinner.succeed(chalk.green('✅ Account information retrieved'));
      
      // Credits section
      const credits = creditsResponse.data.credits || 0;
      console.log(chalk.bold.green('💰 Credit Balance'));
             console.log(chalk.gray(`   Current Balance: $${credits.toFixed(4)}`));
      
      if (credits < 0.01) {
        console.log(chalk.red('   Status: ⚠️  Insufficient balance for requests'));
      } else if (credits < 1.00) {
        console.log(chalk.yellow('   Status: ⚠️  Low balance - consider adding credits'));
      } else {
        console.log(chalk.green('   Status: ✅ Good balance'));
      }
      
      // API Key status
      const status = statusResponse.data;
      console.log(chalk.bold.cyan('\n🔑 API Key Status'));
      if (status.hasKey) {
        console.log(chalk.gray(`   Status: ${status.isActive ? '✅ Active' : '❌ Inactive'}`));
        console.log(chalk.gray(`   Created: ${status.createdAt}`));
        console.log(chalk.gray(`   Last Used: ${status.lastUsed || 'Never'}`));
      } else {
        console.log(chalk.red('   Status: ❌ No API key found'));
      }
      
      // Usage summary
      const usage = usageResponse.data.usage;
      if (usage.total) {
        console.log(chalk.bold.magenta('\n📊 Usage Summary'));
        console.log(chalk.gray(`   Total Requests: ${usage.total.total_requests || 0}`));
        console.log(chalk.gray(`   Total Tokens: ${(usage.total.total_tokens || 0).toLocaleString()}`));
        if (usage.total.total_cost_usd !== null && usage.total.total_cost_usd !== undefined) {
          console.log(chalk.gray(`   Total Spent: $${(usage.total.total_cost_usd || 0).toFixed(4)}`));
        }
      }
      
      // Recent activity
      if (usage.recent && usage.recent.length > 0) {
        console.log(chalk.bold.blue('\n📅 Recent Activity (Last 7 Days)'));
        const recent = usage.recent.slice(0, 7);
        recent.forEach(day => {
          const freeCount = day.requests_by_type?.free || 0;
          const paidCount = day.requests_by_type?.paid || 0;
          console.log(chalk.gray(`   ${day.date}: ${day.requests} requests (${freeCount} free, ${paidCount} paid)${day.cost_usd ? `, $${day.cost_usd.toFixed(4)}` : ''}`));
        });
      }
      
      console.log(chalk.gray('\n💡 Use individual commands for more details:'));
      console.log(chalk.gray('   • dbclean-cli credits     - Credit balance'));
      console.log(chalk.gray('   • dbclean-cli usage       - Detailed usage stats'));
      console.log(chalk.gray('   • dbclean-cli status      - API key status'));
      console.log('');
      
    } catch (err) {
      spinner.fail('Failed to fetch account information');
      if (err.response?.status === 401) {
        console.error(chalk.red('❌ Invalid API key or email'));
      } else {
        console.error(chalk.red(err?.response?.data?.error || err.message));
      }
    }
  });

// Check API key status
program
  .command('status')
  .description('Check the status of your API key')
  .action(async () => {
    const email = config.get('email');
    const apiKey = config.get('apiKey');
    
    if (!email) {
      console.log(chalk.red('❌ Please run `dbclean-cli init` first to set your email'));
      return;
    }

    const spinner = ora('Checking API key status...').start();
    try {
      const response = await axios.get(`${API_BASE_URL}/api/keys/status`, {
        params: { email: email },
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const data = response.data;
      spinner.succeed('API key status retrieved');
      
      console.log(chalk.bold.blue('\n📊 API Key Status Report\n'));
      console.log(chalk.cyan(`📧 Email: ${email}`));
      
      if (data.hasKey) {
        console.log(chalk.green(`✅ Has API Key: Yes`));
        console.log(chalk[data.isActive ? 'green' : 'red'](`🔄 Status: ${data.isActive ? 'Active' : 'Inactive'}`));
        console.log(chalk.gray(`📅 Created: ${data.createdAt}`));
        console.log(chalk.gray(`⏰ Last Used: ${data.lastUsed || 'Never'}`));
        
        if (!data.isActive) {
          console.log(chalk.yellow('\n⚠️  Your API key is inactive. You may need to create a new one.'));
        }
      } else {
        console.log(chalk.red(`❌ Has API Key: No`));
        console.log(chalk.yellow('💡 You may need to create an API key first'));
      }
      
      // If we have a local API key, test if it matches
      if (apiKey && data.hasKey && data.isActive) {
        console.log(chalk.gray('\n🔍 Testing local API key...'));
        try {
          const authResponse = await axios.post(`${API_BASE_URL}/api/keys/authenticate`, {
            email: email,
            apiKey: apiKey
          });
          
          if (authResponse.data.authenticated) {
            console.log(chalk.green('✅ Local API key matches and is valid'));
          } else {
            console.log(chalk.red('❌ Local API key does not match or is invalid'));
          }
        } catch (authErr) {
          console.log(chalk.red('❌ Local API key validation failed'));
        }
      }
      
      console.log(''); // Empty line for spacing
      
    } catch (err) {
      spinner.fail('Failed to check status');
      console.error(chalk.red(err?.response?.data?.error || err.message));
    }
  });

// Helper function to handle API errors
function handleApiError(error, operation) {
  if (error?.response?.data?.error?.includes('exceeded your monthly limit of 5 free requests')) {
    console.log(chalk.red('\n⚠️  Monthly Free Request Limit Reached'));
    console.log(chalk.yellow('You have used all 5 free requests for this month.'));
    console.log(chalk.cyan('To continue using the service, you need to:'));
    console.log(chalk.gray('1. Add credits to your account (minimum $0.01)'));
    console.log(chalk.gray('2. Or wait until next month for new free requests'));
    console.log(chalk.gray('\nRun `dbclean-cli credits` to check your balance'));
  } else if (error?.response?.data?.error) {
    console.error(chalk.red(`${operation} failed: ${error.response.data.error}`));
  } else {
    console.error(chalk.red(`${operation} failed: ${error.message}`));
  }
}

// Architect - AI-powered schema design
program
  .command('architect')
  .description('Process CSV data with AI to create standardized schema design')
  .option('-x, --sample-size <number>', 'Number of first rows to process from the CSV (default: 5)', parseInt)
  .option('-i, --instructions', 'Use custom instructions from instructions.txt file (defined in config.json)')
  .option('-m, --model <model>', 'AI model to use for processing')
  .option('--list-models', 'List available AI models')
  .option('--create-mapping', 'Only create column mapping from existing architect output')
  .action(async (options) => {
    try {
      // Handle list models option
      if (options.listModels) {
        const spinner = ora('Fetching available AI models...').start();
        try {
          const models = await getAvailableModels();
          if (models.length > 0) {
            spinner.succeed(chalk.green('✅ Available AI models:'));
            models.forEach((model, index) => {
              console.log(chalk.cyan(`  ${index + 1}. ${model}`));
            });
          } else {
            spinner.fail(chalk.red('❌ No models available or could not fetch models'));
          }
        } catch (error) {
          spinner.fail(chalk.red('❌ Failed to fetch models'));
          console.error(chalk.red(error.message));
        }
        return;
      }

      // Handle custom instructions from config-defined file
      let customInstructions = null;
      if (options.instructions) {
        // Use package directory for settings files
        const packageSettingsDir = appConfig._packageDir ? 
          path.join(appConfig._packageDir, appConfig.settings__dir || 'settings') :
          path.join(path.dirname(import.meta.url.replace('file://', '')), appConfig.settings__dir || 'settings');
        const instructionsFilePath = path.join(packageSettingsDir, appConfig.settings_instructions_file_path || 'instructions.txt');
        
        try {
          customInstructions = fs.readFileSync(instructionsFilePath, 'utf-8').trim();
          console.log(chalk.gray(`📄 Loaded custom instructions from: ${instructionsFilePath}`));
        } catch (error) {
          console.log(chalk.red(`❌ Instructions file not found: ${instructionsFilePath}`));
          console.log(chalk.cyan(`💡 Create an instructions.txt file in the settings directory to use custom instructions`));
          return;
        }
      }

      if (options.createMapping) {
        // Only create column mapping without running architect
        const spinner = ora('Creating column mapping from existing architect log...').start();
        const mapping = await createColumnMapping();
        if (mapping) {
          spinner.succeed(chalk.green('✅ Column mapping completed successfully'));
        } else {
          spinner.fail(chalk.red('❌ Failed to create column mapping'));
        }
      } else {
        // Get email and API key from config
        const email = config.get('email');
        const apiKey = config.get('apiKey');
        
        if (!email || !apiKey) {
          console.log(chalk.red('❌ Please run `dbclean-cli init` first to set your email and API key'));
          return;
        }

        // Define sample size first
        const sampleSize = options.sampleSize || 5;

        // Show pre-processing info
        console.log(chalk.cyan('🚀 Starting AI schema design...'));
        console.log(chalk.gray(`   • Sample size: ${sampleSize} rows`));
        if (options.model) {
          console.log(chalk.gray(`   • Model: ${options.model}`));
        }
        if (customInstructions) {
          const preview = customInstructions.length > 100 
            ? customInstructions.substring(0, 100) + '...'
            : customInstructions;
          console.log(chalk.gray(`   • Custom instructions: ${preview}`));
        }
        console.log(''); // Empty line for spacing
        const spinner = ora('Processing with AI...').start();
        
        try {
          await runArchitect(sampleSize, customInstructions, email, apiKey, options.model);
          spinner.succeed(chalk.green('✅ AI schema design completed successfully!'));
          
          // Show results
          console.log(chalk.cyan('📋 Results:'));
          console.log(chalk.gray(`   • Output saved to: outputs/architect_output.txt`));
          console.log(chalk.gray(`   • Column mapping: outputs/column_mapping.json`));
          console.log(chalk.gray(`   • Complete log: outputs/architect_log.txt`));
          
        } catch (error) {
          spinner.fail(chalk.red('❌ AI schema design failed'));
          handleApiError(error, 'Schema design');
          return;
        }
      }
    } catch (error) {
      console.error(chalk.red('❌ Fatal error:', error.message));
    }
  });

// Dedupe - Find and remove duplicate records
program
  .command('dedupe')
  .description('Find and remove duplicate records from CSV data using AI-powered analysis of unique columns')
  .option('-t, --threshold <number>', 'Similarity threshold 0-1 (default: 0.85)', parseFloat)
  .option('-s, --strategy <strategy>', 'Matching strategy: levenshtein|jaccard|combined (default: levenshtein)')
  .option('-m, --model <model>', 'AI model to use for deduplication decisions')
  .option('--show-input', 'Display the formatted input that would be sent to AI without making the request')
  .action(async (options) => {
    try {
      console.log(chalk.cyan('🤖 Starting AI-powered duplicate detection...'));
      
      // Show configuration
      const dedupeConfig = {
        threshold: options.threshold || 0.85,
        strategy: options.strategy || 'levenshtein',
        model: options.model || 'default',
        showInput: options.showInput || false
      };
      
      console.log(chalk.gray(`   • Fields: Using unique columns from column mapping`));
      console.log(chalk.gray(`   • AI Model: ${dedupeConfig.model}`));
      console.log(chalk.gray(`   • Threshold: ${dedupeConfig.threshold}`));
      console.log(chalk.gray(`   • Strategy: ${dedupeConfig.strategy}`));
      if (dedupeConfig.showInput) {
        console.log(chalk.gray(`   • Show input mode: enabled (no AI request will be made)`));
      }
      console.log(''); // Empty line for spacing
      
      const spinner = ora('Processing duplicate detection...').start();
      
      try {
        // Get authentication credentials
        const email = config.get('email');
        const apiKey = config.get('apiKey');
        
        if (!email || !apiKey) {
          spinner.fail(chalk.red('❌ Authentication required'));
          console.log(chalk.red('Please run `dbclean-cli init` first to set your email and API key'));
          return;
        }

        const result = await runDedupe({
          threshold: options.threshold,
          strategy: options.strategy,
          showInput: options.showInput,
          email: email,
          apiKey: apiKey,
          model: options.model
        });
        
        if (result.success) {
          if (result.skipped) {
            spinner.succeed(chalk.yellow('✅ Duplicate detection skipped'));
            console.log(chalk.yellow(`ℹ️  ${result.reason}`));
            console.log(chalk.gray('💡 To enable deduplication, mark columns as unique in the architect output using ```UNIQUE``` prefix'));
          } else if (result.showInput) {
            spinner.succeed(chalk.cyan('✅ AI input displayed'));
            // Input was already displayed in the dedupe function
          } else {
            spinner.succeed(chalk.green('✅ Duplicate detection completed successfully!'));
            
            // Show results
            console.log(chalk.cyan('📋 Results:'));
            console.log(chalk.gray(`   • Original records: ${result.stats.originalCount}`));
            console.log(chalk.gray(`   • Duplicate groups: ${result.stats.duplicateGroups}`));
            console.log(chalk.gray(`   • Duplicates removed: ${result.stats.duplicatesRemoved}`));
            console.log(chalk.gray(`   • Final record count: ${result.stats.finalCount}`));
            if (result.stats.originalCount > 0) {
              const dedupeRate = ((result.stats.duplicatesRemoved / result.stats.originalCount) * 100).toFixed(2);
              console.log(chalk.gray(`   • Deduplication rate: ${dedupeRate}%`));
            }
            console.log(chalk.gray(`   • Unique columns used: ${result.uniqueColumns.join(', ')}`));
            
            if (result.outputPath) {
              console.log(chalk.gray(`   • Output file: ${result.outputPath}`));
            }
            if (result.reportPath) {
              console.log(chalk.gray(`   • Report: ${result.reportPath}`));
            }
            
            if (result.duplicateGroups === 0) {
              console.log(chalk.green('\n🎉 No duplicates found with current settings!'));
            } else if (dedupeConfig.showInput) {
              console.log(chalk.yellow('\n👀 Input display mode - no AI request was made.'));
              console.log(chalk.cyan('Run without --show-input to perform actual deduplication.'));
            } else {
              console.log(chalk.green('\n🎉 AI-powered deduplication complete!'));
            }
          }
        } else {
          spinner.fail(chalk.red('❌ Duplicate detection failed'));
        }
      } catch (error) {
        spinner.fail(chalk.red('❌ Duplicate detection failed'));
        handleApiError(error, 'Deduplication');
        return;
      }
    } catch (error) {
      console.error(chalk.red('❌ Fatal error:', error.message));
    }
  });

// Cleaner - AI-powered data cleaning by column
program
  .command('cleaner')
  .description('Process CSV columns with AI to clean and standardize data')
  .option('-m, --model <model>', 'AI model to use for processing')
  .option('--list-models', 'List available AI models')
  .action(async (options) => {
    try {
      // Handle list models option
      if (options.listModels) {
        const spinner = ora('Fetching available AI models...').start();
        try {
          const models = await getAvailableModels();
          if (models.length > 0) {
            spinner.succeed(chalk.green('✅ Available AI models:'));
            models.forEach((model, index) => {
              console.log(chalk.cyan(`  ${index + 1}. ${model}`));
            });
          } else {
            spinner.fail(chalk.red('❌ No models available or could not fetch models'));
          }
        } catch (error) {
          spinner.fail(chalk.red('❌ Failed to fetch models'));
          console.error(chalk.red(error.message));
        }
        return;
      }

      // Get email and API key from config
      const email = config.get('email');
      const apiKey = config.get('apiKey');
      
      if (!email || !apiKey) {
        console.log(chalk.red('❌ Please run `dbclean-cli init` first to set your email and API key'));
        return;
      }

      console.log(chalk.cyan('🧹 Starting AI data cleaning by columns...'));
      console.log(chalk.gray(`   • API endpoint: ${process.env.DBCLEAN_API_URL || 'https://dbclean-api.dbcleandev.workers.dev'}`));
      if (options.model) {
        console.log(chalk.gray(`   • Model: ${options.model}`));
      }
      console.log(''); // Empty line for spacing
      
      const spinner = ora('Processing columns with AI...').start();
      
      try {
        const success = await runCleaner(email, apiKey, options.model);
        if (success) {
          spinner.succeed(chalk.green('✅ AI data cleaning completed successfully!'));
          
          // Show results
          console.log(chalk.cyan('📋 Results:'));
          console.log(chalk.gray(`   • Column outputs: outputs/cleaned_columns/outputs/`));
          console.log(chalk.gray(`   • Column logs: outputs/cleaned_columns/logs/`));
        } else {
          spinner.fail(chalk.red('❌ AI data cleaning failed'));
        }
      } catch (error) {
        spinner.fail(chalk.red('❌ AI data cleaning failed'));
        handleApiError(error, 'Data cleaning');
        return;
      }
    } catch (error) {
      console.error(chalk.red('❌ Fatal error:', error.message));
    }
  });

// Stitcher - Create final stitched CSV with all changes applied
program
  .command('stitcher')
  .description('Create final stitched CSV by applying architect and cleaner changes')
  .action(async () => {
    try {
      console.log(chalk.cyan('🧩 Starting stitcher process...'));
      console.log(chalk.gray('   • Applies architect corrections to first rows'));
      console.log(chalk.gray('   • Applies cleaner changes to specific columns'));
      console.log(chalk.gray('   • Creates data_stitched.csv with all changes'));
      console.log(''); // Empty line for spacing
      
      const spinner = ora('Creating stitched CSV...').start();
      
      try {
        const success = await runStitcher();
        if (success) {
          spinner.succeed(chalk.green('✅ Stitcher process completed successfully!'));
          
          // Show results
          console.log(chalk.cyan('📋 Results:'));
          console.log(chalk.gray(`   • Final CSV: data/data_stitched.csv`));
          console.log(chalk.gray(`   • Changes analysis: outputs/cleaner_changes_analysis.html`));
          console.log(chalk.gray(`   • Ready for use!`));
        } else {
          spinner.fail(chalk.red('❌ Stitcher process failed'));
        }
      } catch (error) {
        spinner.fail(chalk.red('❌ Stitcher process failed'));
        console.error(chalk.red(error.message));
      }
    } catch (error) {
      console.error(chalk.red('❌ Fatal error:', error.message));
    }
  });

// Isosplit - Detect outliers and split data into train/validate/test sets
program
  .command('isosplit')
  .description('Detect outliers and split data into train/validate/test sets')
  .action(async () => {
    try {
      console.log(chalk.cyan('📊 Starting Isosplit process...'));
      console.log(chalk.gray('   • Detects outliers using Isolation Forest'));
      console.log(chalk.gray('   • Splits data into train/validate/test sets'));
      console.log(''); // Empty line for spacing
      
      const spinner = ora('Detecting outliers and splitting data...').start();
      
      try {
        const success = await runIsosplit();
        if (success) {
          spinner.succeed(chalk.green('✅ Isosplit process completed successfully!'));
          
          // Show results
          console.log(chalk.cyan('📋 Results:'));
          console.log(chalk.gray(`   • Train data: data/train.csv`));
          console.log(chalk.gray(`   • Validate data: data/validate.csv`));
          console.log(chalk.gray(`   • Test data: data/test.csv`));
          console.log(chalk.gray(`   • Ready for use!`));
        } else {
          spinner.fail(chalk.red('❌ Isosplit process failed'));
        }
      } catch (error) {
        spinner.fail(chalk.red('❌ Isosplit process failed'));
        console.error(chalk.red(error.message));
      }
    } catch (error) {
      console.error(chalk.red('❌ Fatal error:', error.message));
    }
  });

// Run - Execute the full pipeline (preclean → architect → cleaner → stitcher)
program
  .command('run')
  .description('Run the full data processing pipeline: preclean -> architect -> cleaner -> stitcher -> dedupe -> isosplit')
  .option('--input <path>', 'Input CSV file path (default: data.csv)')
  .option('-x, --sample-size <number>', 'Number of first rows to process in architect (default: 5)', parseInt)
  .option('-i, --instructions', 'Use custom instructions from instructions.txt file')
  .option('-m, --model <model>', 'AI model to use for both architect and cleaner')
  .option('--model-architect <model>', 'AI model to use specifically for architect')
  .option('--model-cleaner <model>', 'AI model to use specifically for cleaner')
  .option('--list-models', 'List available AI models')
  .option('--skip-preclean', 'Skip the preclean step (assumes data_cleaned.csv already exists)')
  .option('--skip-architect', 'Skip the architect step (assumes outputs already exist)')
  .option('--skip-dedupe', 'Skip the dedupe step (skip duplicate removal)')
  .option('--skip-cleaner', 'Skip the cleaner step (skip column-level cleaning)')
  .option('--skip-isosplit', 'Skip the outlier detection and data splitting step')
  .action(async (options) => {
    try {
      // Handle list models option
      if (options.listModels) {
        const spinner = ora('Fetching available AI models...').start();
        try {
          const models = await getAvailableModels();
          if (models.length > 0) {
            spinner.succeed(chalk.green('✅ Available AI models:'));
            models.forEach((model, index) => {
              console.log(chalk.cyan(`  ${index + 1}. ${model}`));
            });
          } else {
            spinner.fail(chalk.red('❌ No models available or could not fetch models'));
          }
        } catch (error) {
          spinner.fail(chalk.red('❌ Failed to fetch models'));
          console.error(chalk.red(error.message));
        }
        return;
      }

      // Determine models to use
      const architectModel = options.modelArchitect || options.model || null;
      const cleanerModel = options.modelCleaner || options.model || null;

      // Get email and API key from config
      const email = config.get('email');
      const apiKey = config.get('apiKey');
      
      if (!email || !apiKey) {
        console.log(chalk.red('❌ Please run `dbclean-cli init` first to set your email and API key'));
        return;
      }

      // Handle custom instructions
      let customInstructions = null;
      if (options.instructions) {
        // Use package directory for settings files
        const packageSettingsDir = appConfig._packageDir ? 
          path.join(appConfig._packageDir, appConfig.settings__dir || 'settings') :
          path.join(path.dirname(import.meta.url.replace('file://', '')), appConfig.settings__dir || 'settings');
        const instructionsFilePath = path.join(packageSettingsDir, appConfig.settings_instructions_file_path || 'instructions.txt');
        
        try {
          customInstructions = fs.readFileSync(instructionsFilePath, 'utf-8').trim();
          console.log(chalk.gray(`📄 Loaded custom instructions from: ${instructionsFilePath}`));
        } catch (error) {
          console.log(chalk.red(`❌ Instructions file not found: ${instructionsFilePath}`));
          console.log(chalk.cyan(`💡 Create an instructions.txt file in the settings directory to use custom instructions`));
          return;
        }
      }

      const sampleSize = options.sampleSize || 5;

      // Show pipeline overview
      console.log(chalk.bold.blue('\n🚀 Starting Complete DBClean Pipeline\n'));
      console.log(chalk.cyan('Pipeline Steps:'));
      if (!options.skipPreclean) {
        console.log(chalk.gray('  1. 🧹 Preclean CSV Data'));
      }
      if (!options.skipArchitect) {
        console.log(chalk.gray(`  ${options.skipPreclean ? '1' : '2'}. 🏗️  Architect schema design (${sampleSize} rows)${architectModel ? ` [${architectModel}]` : ''}`));
      }
      if (!options.skipDedupe) {
        console.log(chalk.gray(`  ${(options.skipPreclean ? 0 : 1) + (options.skipArchitect ? 0 : 1) + 1}. 🤖 AI-powered dedupe removal`));
      }
      if (!options.skipCleaner) {
        console.log(chalk.gray(`  ${(options.skipPreclean ? 0 : 1) + (options.skipArchitect ? 0 : 1) + (options.skipDedupe ? 0 : 1) + 1}. 🧹 Cleaner column processing${cleanerModel ? ` [${cleanerModel}]` : ''}`));
      }
      console.log(chalk.gray(`  ${(options.skipPreclean ? 0 : 1) + (options.skipArchitect ? 0 : 1) + (options.skipDedupe ? 0 : 1) + (options.skipCleaner ? 0 : 1) + 1}. 🧩 Stitcher final assembly`));
      if (!options.skipIsosplit) {
        console.log(chalk.gray(`  ${(options.skipPreclean ? 0 : 1) + (options.skipArchitect ? 0 : 1) + (options.skipDedupe ? 0 : 1) + (options.skipCleaner ? 0 : 1) + 1 + 1}. 📊 Isosplit outlier detection and data splitting`));
      }
      if (customInstructions) {
        const preview = customInstructions.length > 100 
          ? customInstructions.substring(0, 100) + '...'
          : customInstructions;
        console.log(chalk.gray(`  📄 Custom instructions: ${preview}`));
      }
      console.log('');

      let stepNumber = 1;

      // Step 1: Preclean (if not skipped)
      if (!options.skipPreclean) {
        console.log(chalk.bold.cyan(`\n📋 Step ${stepNumber}: Preclean CSV Data`));
        stepNumber++;
        
        const spinner = ora('Checking for input CSV file...').start();
        try {
          // Use current working directory for data files
          const workingDir = process.cwd();
          // Create data and outputs directories if they don't exist
          const dataDir = path.join(workingDir, appConfig.data_dir || 'data');
          const outputsDir = path.join(workingDir, appConfig.outputs_dir || 'outputs');
          
          // Ensure directories exist
          if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
          }
          if (!fs.existsSync(outputsDir)) {
            fs.mkdirSync(outputsDir, { recursive: true });
          }
          
          // Use package directory for settings files
          const packageSettingsDir = appConfig._packageDir ? 
            path.join(appConfig._packageDir, appConfig.settings__dir || 'settings') :
            path.join(path.dirname(import.meta.url.replace('file://', '')), appConfig.settings__dir || 'settings');
          
          const originalCsvPath = options.input || path.join(workingDir, 'data.csv');
          const cleanedCsvPath = path.join(dataDir, appConfig.data_cleaned_file_path || 'data_cleaned.csv');
          const excludeFilePath = path.join(packageSettingsDir, appConfig.settings_exclude_columns_file_path || 'exclude_columns.txt');
          
          // Check if input file exists
          if (!fs.existsSync(originalCsvPath)) {
            spinner.fail(chalk.red(`❌ Required input file not found: ${path.basename(originalCsvPath)}`));
            console.log(chalk.bold.red('\n🚨 DBClean Setup Required\n'));
            console.log(chalk.yellow('To use DBClean, you need to provide a CSV file for processing:'));
            console.log(chalk.cyan(`   1. Create or copy your CSV file to: ${originalCsvPath}`));
            console.log(chalk.cyan(`   2. Make sure it's properly formatted with headers`));
            console.log(chalk.cyan(`   3. Run the command again\n`));
            console.log(chalk.gray('Alternative: Use --input <file> to specify a different CSV file'));
            console.log(chalk.gray('Additional information:'));
            console.log(chalk.gray(`   • Expected file path: ${originalCsvPath}`));
            console.log(chalk.gray(`   • Current working directory: ${process.cwd()}`));
            console.log(chalk.gray('\nFor help, run: dbclean-cli --help'));
            return;
          }
          
          spinner.text = 'Cleaning CSV data...';
          const cleanedPath = await cleanCSV(originalCsvPath, cleanedCsvPath, excludeFilePath);
          if (cleanedPath) {
            spinner.succeed(chalk.green('✅ Preclean completed successfully'));
          } else {
            spinner.fail(chalk.red('❌ Preclean failed'));
            return;
          }
        } catch (error) {
          spinner.fail(chalk.red('❌ Preclean failed'));
          console.error(chalk.red(error.message));
          return;
        }
      }

      // Step 2: Architect (if not skipped)
      if (!options.skipArchitect) {
        console.log(chalk.bold.cyan(`\n📋 Step ${stepNumber}: Architect Schema Design`));
        stepNumber++;
        
        const spinner = ora('Processing with AI architect...').start();
        try {
          await runArchitect(sampleSize, customInstructions, email, apiKey, architectModel);
          spinner.succeed(chalk.green('✅ Architect completed successfully'));
        } catch (error) {
          spinner.fail(chalk.red('❌ Architect failed'));
          handleApiError(error, 'Schema design');
          return;
        }
      }

      // Step 3: Dedupe (if not skipped)
      if (!options.skipDedupe) {
        console.log(chalk.bold.cyan(`\n📋 Step ${stepNumber}: AI-Powered Dedupe Removal`));
        stepNumber++;
        
        const spinner = ora('Processing AI-powered duplicate analysis...').start();
        try {
          const result = await runDedupe({
            threshold: 0.85,  // Default threshold
            strategy: 'levenshtein',  // Default strategy
            email: email,
            apiKey: apiKey,
            model: cleanerModel  // Use the same model as cleaner if specified
          });
          if (result.success) {
            if (result.skipped) {
              spinner.succeed(chalk.yellow('✅ Dedupe skipped - no unique columns found'));
              console.log(chalk.gray('   • No columns marked as unique for deduplication'));
            } else {
              spinner.succeed(chalk.green('✅ Dedupe completed successfully'));
              if (result.stats.duplicatesRemoved > 0) {
                console.log(chalk.gray(`   • Removed ${result.stats.duplicatesRemoved} duplicates from ${result.stats.originalCount} records`));
                console.log(chalk.gray(`   • Unique columns used: ${result.uniqueColumns.join(', ')}`));
              } else {
                console.log(chalk.gray('   • No duplicates found'));
                console.log(chalk.gray(`   • Unique columns used: ${result.uniqueColumns.join(', ')}`));
              }
            }
          } else {
            spinner.fail(chalk.red('❌ Dedupe failed'));
            return;
          }
        } catch (error) {
          spinner.fail(chalk.red('❌ Dedupe failed'));
          handleApiError(error, 'Deduplication');
          return;
        }
      }

      // Step 4: Cleaner (if not skipped)
      if (!options.skipCleaner) {
        console.log(chalk.bold.cyan(`\n📋 Step ${stepNumber}: Cleaner Column Processing`));
        stepNumber++;
        
        const spinner = ora('Processing columns with AI cleaner...').start();
        try {
          const success = await runCleaner(email, apiKey, cleanerModel);
          if (success) {
            spinner.succeed(chalk.green('✅ Cleaner completed successfully'));
          } else {
            spinner.fail(chalk.red('❌ Cleaner failed'));
            return;
          }
        } catch (error) {
          spinner.fail(chalk.red('❌ Cleaner failed'));
          handleApiError(error, 'Data cleaning');
          return;
        }
      }

      // Step 5: Stitcher (always runs)
      console.log(chalk.bold.cyan(`\n📋 Step ${stepNumber}: Stitcher Final Assembly`));
      
      const spinner = ora('Creating final stitched CSV...').start();
      try {
        const success = await runStitcher();
        if (success) {
          spinner.succeed(chalk.green('✅ Stitcher completed successfully'));
        } else {
          spinner.fail(chalk.red('❌ Stitcher failed'));
          return;
        }
      } catch (error) {
        spinner.fail(chalk.red('❌ Stitcher failed'));
        console.error(chalk.red(error.message));
        return;
      }

      // Step 6: Isosplit (if not skipped)
      if (!options.skipIsosplit) {
        console.log(chalk.bold.cyan(`\n📋 Step ${stepNumber}: Outlier Detection and Data Splitting`));
        stepNumber++;
        
        const isosplitSpinner = ora('Detecting outliers and splitting data...').start();
        try {
          const success = await runIsosplit();
          if (success) {
            isosplitSpinner.succeed(chalk.green('✅ Isosplit completed successfully'));
          } else {
            isosplitSpinner.fail(chalk.red('❌ Isosplit failed'));
            return;
          }
        } catch (error) {
          isosplitSpinner.fail(chalk.red('❌ Isosplit failed'));
          console.error(chalk.red(error.message));
          return;
        }
      }

      // Success summary
      console.log(chalk.bold.green('\n🎉 Complete DBClean Pipeline Finished Successfully!\n'));
      console.log(chalk.cyan('📋 Final Results:'));
      console.log(chalk.gray(`   • Cleaned CSV: data/${appConfig.data_cleaned_file_path || 'data_cleaned.csv'}`));
      if (!options.skipDedupe) {
        // Note: dedupe may have been skipped internally due to no unique columns
        console.log(chalk.gray(`   • Deduplicated CSV: data/${appConfig.data_deduped_file_path || 'data_deduped.csv'} (if applicable)`));
        console.log(chalk.gray(`   • Dedupe report: outputs/dedupe_report.txt (if deduplication ran)`));
      }
      console.log(chalk.gray(`   • Final CSV: data/data_stitched.csv`));
      console.log(chalk.gray(`   • Architect output: outputs/architect_output.txt`));
      console.log(chalk.gray(`   • Column mapping: outputs/column_mapping.json`));
      if (!options.skipCleaner) {
        console.log(chalk.gray(`   • Cleaner outputs: outputs/cleaned_columns/`));
        console.log(chalk.gray(`   • Changes analysis: outputs/cleaner_changes_analysis.html`));
      }
      console.log(chalk.gray(`   • Train data: data/train.csv`));
      console.log(chalk.gray(`   • Validate data: data/validate.csv`));
      console.log(chalk.gray(`   • Test data: data/test.csv`));
      console.log(chalk.bold.cyan('\n🚀 Your data is ready for use!\n'));

    } catch (error) {
      console.error(chalk.red('❌ Pipeline fatal error:', error.message));
    }
  });


// Test command to showcase ora and chalk
program
  .command('test')
  .description('Test console output with spinners and colors')
  .action(async () => {
    console.log(chalk.bold.blue('\n🧪 Running Console Test Suite\n'));
    
    // Test chalk colors
    console.log(chalk.green('✅ Green text works'));
    console.log(chalk.red('❌ Red text works'));
    console.log(chalk.yellow('⚠️  Yellow text works'));
    console.log(chalk.cyan('💙 Cyan text works'));
    console.log(chalk.magenta('💜 Magenta text works'));
    console.log(chalk.bold('🔥 Bold text works'));
    console.log(chalk.italic('✨ Italic text works'));
    console.log(chalk.underline('📝 Underlined text works'));
    console.log(chalk.bgBlue.white(' 📦 Background colors work '));
    
    console.log('\n' + chalk.bold.yellow('Testing spinners...') + '\n');
    
    // Test different spinner types
    const spinners = [
      { name: 'dots', text: 'Loading with dots...' },
      { name: 'line', text: 'Loading with line...' },
      { name: 'pipe', text: 'Loading with pipe...' },
      { name: 'simpleDots', text: 'Loading with simple dots...' },
      { name: 'star', text: 'Loading with star...' },
      { name: 'arrow', text: 'Loading with arrow...' }
    ];
    
    for (const spinnerConfig of spinners) {
      const spinner = ora({
        text: spinnerConfig.text,
        spinner: spinnerConfig.name,
        color: 'cyan'
      }).start();
      
      await new Promise(resolve => setTimeout(resolve, 1500));
      spinner.succeed(chalk.green(`${spinnerConfig.name} spinner works!`));
    }
    
    // Test spinner state changes
    console.log('\n' + chalk.bold.yellow('Testing spinner states...') + '\n');
    
    const stateSpinner = ora('Testing spinner states...').start();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    stateSpinner.text = 'Changing text...';
    stateSpinner.color = 'yellow';
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    stateSpinner.text = 'Almost done...';
    stateSpinner.color = 'green';
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    stateSpinner.succeed(chalk.green('All spinner states work!'));
    
    // Test failure state
    const failSpinner = ora('Testing failure state...').start();
    await new Promise(resolve => setTimeout(resolve, 1000));
    failSpinner.fail(chalk.red('Failure state works too!'));
    
    // Test warning state
    const warnSpinner = ora('Testing warning state...').start();
    await new Promise(resolve => setTimeout(resolve, 1000));
    warnSpinner.warn(chalk.yellow('Warning state works!'));
    
    // Test info state
    const infoSpinner = ora('Testing info state...').start();
    await new Promise(resolve => setTimeout(resolve, 1000));
    infoSpinner.info(chalk.blue('Info state works!'));
    
    // Final summary
    console.log('\n' + chalk.bold.green('🎉 All tests completed!'));
    console.log(chalk.gray('Your console supports:'));
    console.log(chalk.gray('  • ') + chalk.green('Colors and formatting'));
    console.log(chalk.gray('  • ') + chalk.cyan('Animated spinners'));
    console.log(chalk.gray('  • ') + chalk.yellow('Unicode characters'));
    console.log(chalk.gray('  • ') + chalk.magenta('Dynamic text updates'));
    
    console.log('\n' + chalk.cyan('Everything looks great! \n'));
  });

// END OF COMMANDS
// DO NOT PUT ANY COMMANDS BELOW THIS LINE
program.parse(process.argv);