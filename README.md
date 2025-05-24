# GitHub-Discord Sync

A bidirectional synchronization tool that connects GitHub Organization Discussions with Discord forum threads. This application ensures that discussions on both platforms remain in sync.

## Features

- Create Discord threads when GitHub discussions are created (and vice versa)
- Sync comments between GitHub discussions and Discord threads
- Real-time updates via webhooks (no polling required)
- Supports image sharing between platforms (with proper display)
- Enhanced handling of GitHub user-attachments and HTML image tags
- Consistent message format with clear author attribution
- Streamlined message format for better readability
- Intelligent handling of long messages across platforms
- Dry run mode for testing
- Initial synchronization of existing discussions and threads at startup

## Requirements

- Node.js 16.x or higher
- A GitHub account with access to organization discussions
- A Discord bot with proper permissions
- Discord forum channel

## Setup

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Configure your environment variables by copying the example `.env` file:
   ```
   cp .env.example .env
   ```
4. Edit the `.env` file with your GitHub token, Discord bot token, and other required settings
5. Start the application:
   ```
   npm start
   ```

## Environment Variables

| Variable | Description | Required | Default |
| --- | --- | --- | --- |
| `GITHUB_TOKEN` | GitHub personal access token with org discussion permissions | Yes | - |
| `DISCORD_TOKEN` | Discord bot token | Yes | - |
| `GITHUB_OWNER` | GitHub repository owner/organization | No | dzeiocom |
| `GITHUB_REPO` | GitHub repository name | No | github-sync |
| `FORUM_CHANNEL_ID` | Discord forum channel ID | No | 1375527112521552003 |
| `CATEGORY_NAME` | GitHub discussion category name | No | General |
| `POLL_INTERVAL` | Legacy polling interval (no longer used with webhooks) | No | 60000 |
| `DRY_RUN` | Enable dry run mode (read data but skip write operations) | No | false |


## Usage

### Starting the Application

To start the application in normal mode:
```
npm start
```

To start in development mode with automatic restarts:
```
npm run dev
```

### Initial Synchronization

When the application starts, it automatically:
- Scans all existing GitHub discussions and Discord threads
- Creates Discord threads for GitHub discussions that don't have a thread
- Creates GitHub discussions for Discord threads that don't have a discussion
- Establishes links between them for future synchronization

This ensures all content is in sync without manual intervention.

### Dry Run Mode

To test the application without modifying any data:
```
npm run start:dry
```

Or in development mode:
```
npm run dev:dry
```

Dry run mode:
- Uses real API calls to read data from GitHub and Discord
- Logs all write operations that would be performed
- Does not create, update, or modify any data on either platform
- Allows you to verify your configuration with real data before making changes

This is ideal for testing your setup with actual data while ensuring no changes are made to your GitHub discussions or Discord threads.

## GitHub Webhook Setup

1. Go to your GitHub repository settings
2. Navigate to Webhooks
3. Add a new webhook with the following settings:
   - Payload URL: `http://your-server:3000/webhook`
   - Content type: `application/json`
   - Events: Select both "Discussions" and "Discussion comments"
4. Save the webhook

The application uses webhooks for real-time updates instead of polling, making it more efficient and responsive.

## Important Notes

This application uses GitHub's repository-level discussions, not organization discussions. Make sure:

1. You have enabled Discussions in your repository (Settings > Features > Discussions)
2. You have created at least one discussion category matching your `CATEGORY_NAME` setting
3. Your GitHub token has appropriate permissions for repository discussions

## Discord Bot Setup

Basic setup steps:

1. Create a Discord application at https://discord.com/developers/applications
2. Create a bot for your application
3. Enable the following Privileged Gateway Intents:
   - Server Members Intent
   - Message Content Intent (**REQUIRED** - without this, the bot will fail to connect)
4. Use the OAuth2 URL Generator to create an invite link with the following permissions:
   - Read Messages/View Channels
   - Send Messages
   - Create Public Threads
   - Send Messages in Threads
   - Add Reactions
5. Invite the bot to your server

For detailed instructions with screenshots, see [DISCORD_SETUP.md](DISCORD_SETUP.md).

## Troubleshooting

- **Discord login fails**: Check that your bot token is correct and you've enabled the **Message Content Intent** in the Discord Developer Portal
- **GitHub API calls fail**: Verify your GitHub token has the correct permissions for organization discussions
- **Sync not working**: Check that the channel IDs and organization names are correct in your .env file
- **No error messages**: Try enabling dry run mode to see if the expected operations are being logged
- **Images not displaying**: The application automatically converts image formats between platforms (Markdown format in GitHub to direct URLs in Discord and vice versa)
- **Long messages truncated**: Very long messages are automatically split into multiple messages to ensure complete synchronization

## Image Handling

This application fully supports sharing and displaying images between platforms:

- **GitHub to Discord**: Markdown images (`![alt text](https://example.com/image.jpg)`) are properly embedded in Discord
- **GitHub user-attachments**: Special handling for GitHub's attachment format (`https://github.com/user-attachments/assets/id`)
- **HTML image tags**: Properly extracts and displays images from HTML `<img>` tags
- **Discord to GitHub**: Image attachments and URLs are converted to Markdown format for proper display in GitHub
- **Automatic embedding**: Images are displayed inline, not just as links
- **Attachment support**: Attached images in Discord are properly displayed in GitHub and vice versa
- **Proper formatting**: Ensures images are properly spaced and formatted for optimal display
- **Supported formats**: png, jpg, jpeg, gif, and webp

## Content Attribution

Content synced between platforms follows a consistent format:

- **Consistent format**: All messages follow the pattern: `{username} on [Platform](link) wrote:`
- **Clear author attribution**: Every message clearly shows who wrote the original content
- **Direct navigation**: Clickable links take you directly to the original source
- **Platform identification**: Each message indicates whether it came from GitHub or Discord

## License

MIT