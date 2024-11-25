# ChronoLens AI - Browser History Analyzer

## Overview
ChronoLens AI is a powerful Chrome extension that provides AI-powered insights into your browsing history. It generates detailed, chronological summaries of your web activities using advanced natural language processing.

## 🌟 Features

### Core Functionality
- **AI-Powered Summaries**: Generate detailed activity reports using Claude AI
- **Real-time Tracking**: Monitor unique sites visited
- **Beautiful UI**: Clean, modern interface with hover effects and smooth animations
- **Structured Output**: Well-formatted tables with grid lines and proper spacing

### Data Organization
- **Chronological Order**: Activities grouped by date
- **Detailed Breakdown**: 
  - Precise timestamps
  - Website information
  - Domain tracking
  - Activity descriptions

### User Experience
- **Interactive Elements**: 
  - Generate AI Summary button
  - Export History functionality
  - Copy to clipboard feature
- **Visual Feedback**: 
  - Loading indicators
  - Success messages
  - Error handling
- **Responsive Design**: Clean layout with proper spacing and animations

## 🛠 Technical Stack

### Frontend
- HTML5
- CSS3 (Modern features)
- JavaScript (ES6+)
- Font Awesome icons
- Google Fonts (Inter, JetBrains Mono)

### Backend
- Chrome Extension APIs
- Anthropic Claude API (AI processing)
- Chrome Storage API (Data persistence)

### Build Tools
- Webpack
- Babel
- dotenv-webpack

## 📦 Installation

1. Clone the repository:
   ```bash
   git clone [repository-url]
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file with your Anthropic API key:
   ```env
   ANTHROPIC_API_KEY=your_api_key_here
   ```

4. Build the extension:
   ```bash
   npm run build
   ```

5. Load in Chrome:
   - Open Chrome Extensions (chrome://extensions/)
   - Enable Developer Mode
   - Click "Load unpacked"
   - Select the built extension directory

## 🔧 Configuration

### Required Permissions
- `history`: Access browsing history
- `storage`: Store extension data
- `activeTab`: Interact with current tab

### API Configuration
- Model: claude-3-5-haiku-20241022
- Endpoint: https://api.anthropic.com/v1/messages

## 🎯 Usage

1. Click the extension icon to open the popup
2. View the number of unique sites visited
3. Click "Generate AI Summary" for detailed analysis
4. Use "Export History" to save your data
5. Copy results to clipboard as needed

## 🎨 UI Components

### Stats Display
- Clean stat cards with hover effects
- Real-time site count updates

### Activity Tables
- Fixed-width time column (80px)
- Website and domain columns (120px each)
- Expandable description column
- Grid lines and hover effects
- Proper text wrapping

### Interactive Elements
- Gradient buttons with hover effects
- Loading animations
- Success/error messages

## 🔒 Security

- Secure API key handling via environment variables
- Content Security Policy implementation
- No sensitive data storage
- Proper error handling

## 🛠 Development

### Build Process
```bash
npm run build
```

### Development Mode
```bash
npm run dev
```

### Testing
```bash
npm test
```

## 📝 Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 👨‍💻 Author

**Bhuvan GNK**
- LinkedIn: [Bhuvan GNK](https://linkedin.com/in/gnkbhuvan)

## 🙏 Acknowledgments

- Anthropic for the Claude AI API
- Chrome Extension development community
- Contributors and testers

---

For questions or support, please open an issue in the repository.