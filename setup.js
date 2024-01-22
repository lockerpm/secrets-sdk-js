const https = require('https');
const fs = require('fs');
const os = require('os');

// Function to determine the platform and architecture
function getPlatformInfo() {
  switch (os.platform()) {
    case 'darwin':
      // Check the processor architecture for macOS
      return os.arch() === 'arm64' ? 'macos-arm64' : 'macos-x64';
    case 'win32':
      return 'windows';
    case 'linux':
      return 'linux';
    default:
      throw new Error('Unsupported platform');
  }
}

// Function to download a file based on the platform and architecture
function downloadFile(platform) {
  let url;

  if (platform === 'macos-arm64') {
    url = 'https://s.locker.io/download/locker-cli-mac-arm64-1.0.69';
  } else if (platform === 'macos-x64') {
    url = 'https://s.locker.io/download/locker-cli-mac-x64-1.0.69';
  } else if (platform === 'windows') {
    url = 'https://s.locker.io/download/locker-cli-win-x64-1.0.69.exe';
  } else if (platform === 'linux') {
    url = 'https://s.locker.io/download/locker-cli-linux-x64-1.0.69';
  } else {
    throw new Error('Unsupported platform');
  }

  const fileStream = fs.createWriteStream(`./bin/locker_secret${platform === 'windows' ? '.exe' : ''}`);

  https.get(url, (response) => {
    response.pipe(fileStream);

    fileStream.on('finish', () => {
      fileStream.close();
      console.log(`File downloaded and saved to ./bin/locker_secret${platform === 'windows' ? '.exe' : ''}`);
    });
  }).on('error', (err) => {
    fs.unlink(`./bin/locker_secret${platform === 'windows' ? '.exe' : ''}`);
    console.error(`Error downloading file: ${err.message}`);
  });
}

// Main script
const platformInfo = getPlatformInfo();
const binFolderPath = './bin';

// Create the 'bin' folder if it doesn't exist
if (!fs.existsSync(binFolderPath)) {
  fs.mkdirSync(binFolderPath);
}

// Download the file based on the platform and architecture
downloadFile(platformInfo);
