# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-06-23

### Added
- Initial release of DBClean CLI
- AI-powered data cleaning and standardization
- Full pipeline automation with `run` and `silent-run` commands
- Individual step commands: `preclean`, `architect`, `cleaner`, `stitcher`
- Multi-model AI support (OpenAI, Anthropic, Google)
- Custom instructions and configuration
- Detailed logging and change tracking
- Authentication system for DBClean API
- Comprehensive error handling and retry logic
- Beautiful CLI interface with progress indicators

### Features
- **Preclean**: CSV data preparation and cleaning
- **Architect**: AI-powered schema design and column mapping
- **Cleaner**: Column-by-column data standardization
- **Stitcher**: Final data assembly and analysis
- **Model Selection**: Choose different AI models per step
- **Batch Processing**: Handle large datasets with token management
- **Skip Options**: Flexible pipeline execution
- **Silent Mode**: Background processing with file logging

### Commands
- `init` - Setup authentication
- `run` - Interactive full pipeline
- `preclean` - Data preparation
- `architect` - Schema design
- `cleaner` - Data cleaning
- `stitcher` - Final assembly
- `test-auth` - Verify API credentials
- `status` - Check API status
- `test` - Test console output 