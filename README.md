# TwinDeploy (Web, runs locally)

A small **local web app** that detects **changed or staged Git files**, lets you **choose exactly which files to deploy**, uploads them to **SFTP/FTPS targets**, and can **replay the exact same batch** to another target (e.g., *dev → qa*) — all from your browser.

> Stack: **Node.js (Express)** backend + **React (Vite)** frontend. Git via `simple-git`. SFTP via `ssh2-sftp-client`. FTPS via `basic-ftp`. Progress updates via Server-Sent Events (SSE).

---

## Features

* Detect **changed since base ref** (e.g., `main`, a tag, or a commit) **or** only **staged** files
* Checkbox UI to select files you actually want to deploy
* **Profiles**: add/edit SFTP/FTPS targets (host, user, key/password, remote root)
* **Deploy** selected files to a target
* **Replay** the same manifest to another target later
* **History** with timestamps, sizes, and results

---

## Upcoming Features

### 🚀 High Priority

* [ ] **Local Repository Browser**: Browse local repository files/folders and manually add them to deployment queue (beyond just Git changes)
* [ ] **File Conflict Resolution**: Handle overwrites with backup options and conflict detection
* [ ] **Batch Operations**: Select and deploy multiple file sets with different targets
* [ ] **Deployment Templates**: Save common deployment configurations for quick reuse
* [ ] **Progress Persistence**: Resume interrupted deployments from where they left off

### 🎯 Medium Priority

* [ ] **Advanced File Filtering**: Exclude patterns, file size limits, and content-based filters
* [ ] **Target Health Check**: Verify connectivity and permissions before deployment
* [ ] **Deployment Scheduling**: Queue deployments and run them at specified times
* [ ] **File Comparison**: Visual diff between local and remote files before deployment

### 💡 Future Enhancements

* [ ] **Multi-Repository Support**: Manage deployments across multiple Git repositories
* [ ] **Team Collaboration**: Share deployment configurations and history with team members
* [ ] **Notification System**: Email/Slack notifications for deployment completion/failures
* [ ] **Rollback Capability**: One-click rollback to previous deployment states
* [ ] **Docker Integration**: Deploy to containerized environments
* [ ] **CI/CD Pipeline Integration**: Webhook triggers from GitHub/GitLab actions

### 🔧 Technical Improvements

* [ ] **Database Migration**: Move from JSON storage to SQLite for better performance
* [ ] **Authentication System**: User accounts and role-based access control
* [ ] **API Rate Limiting**: Prevent abuse and improve stability
* [ ] **Unit Tests**: Comprehensive test coverage for backend and frontend
* [ ] **Performance Optimization**: Parallel transfers and connection pooling
* [ ] **Error Recovery**: Automatic retry logic for failed transfers

> **Contributing**: Feel free to suggest new features by opening an issue or submitting a PR. Features marked with 🚀 are actively being considered for the next release.

---

## Project layout

```
TwinDeploy/
├─ backend/
│  ├─ package.json
│  ├─ index.js              # Express API + SSE progress + deploy engines
│  ├─ deploy.js             # SFTP/FTPS upload logic
│  ├─ git.js                # changed/staged file discovery
│  ├─ store.js              # JSON storage for targets & manifests
│  └─ .env.example          # optional envs (PORT, etc.)
│
├─ frontend/
│  ├─ package.json
│  ├─ index.html
│  ├─ vite.config.js
│  └─ src/
│     ├─ main.jsx
│     ├─ App.jsx
│     ├─ api.js            # small fetch helpers
│     └─ styles.css
│
├─ package.json             # root with scripts to run both
└─ README.md
```

---

## Quick start

```bash
# 1) Install dependencies
cd TwinDeploy/backend && npm i
cd ../frontend && npm i
cd .. && npm i

# 2) Run (dev)
npm run dev
# Frontend on http://localhost:5173, backend on http://localhost:9547
```

> Tip: The app **does not move or clone your repo**. You point it at an existing repo path on your Mac. It reads diffs and streams files from disk when deploying.

---

## Usage

1. **Set Repository Path**: Enter the absolute path to your Git repository
2. **Choose Mode**: Select either "Changed since" (with base ref) or "Staged" files
3. **Scan**: Click "Scan" to detect files
4. **Select Files**: Use checkboxes to choose which files to deploy
5. **Add Target**: Create SFTP/FTPS deployment targets with connection details
6. **Deploy**: Select a target and deploy your chosen files
7. **Replay**: Use the History section to replay previous deployments to different targets

---

## Configuration

### Environment Variables

Copy `backend/.env.example` to `backend/.env` and modify as needed:

```bash
# Backend port
PORT=9547
```

### Target Setup

When adding a new target, you'll need:

* **Name**: A friendly name (e.g., "dev", "staging")
* **Protocol**: Either "sftp" or "ftps"
* **Host**: Server hostname or IP
* **User**: Username for authentication
* **Remote Root**: Base directory on the remote server
* **Private Key**: Path to SSH key (for SFTP) or leave blank for password
* **Password**: Password authentication (if not using key)

---

## API Endpoints

### Repository

* `GET /api/repo/changed?repoPath=...&baseRef=...` - Get changed files

* `GET /api/repo/staged?repoPath=...` - Get staged files

### Targets

* `GET /api/targets` - List all targets

* `POST /api/targets` - Create new target
* `PUT /api/targets/:id` - Update target
* `DELETE /api/targets/:id` - Delete target

### Deployment

* `POST /api/deploy` - Deploy files (returns SSE stream)

* `POST /api/replay` - Replay manifest (returns SSE stream)
* `GET /api/manifests` - List deployment history

---

## Development

```bash
# Install dependencies
npm install

# Run in development mode (both frontend and backend)
npm run dev

# Backend only
cd backend && npm run dev

# Frontend only
cd frontend && npm run dev
```

The frontend will be available at `http://localhost:5173` and will proxy API requests to the backend at `http://localhost:8080`.

---

## Security Notes

* This app runs locally and is intended for development use
* SSH keys and passwords are stored in local JSON files
* Ensure your deployment targets are properly secured
* Consider using SSH key authentication instead of passwords when possible

---

## Troubleshooting

### Common Issues

1. **"Repository not found"**: Ensure the repository path is absolute and points to a valid Git repository
2. **SFTP connection failed**: Check hostname, username, and SSH key path
3. **Permission denied**: Ensure the remote user has write permissions to the target directory
4. **Port conflicts**: Change the PORT in backend/.env if 8080 is already in use

### Logs

Check the browser console and terminal output for detailed error messages. The app includes a built-in log panel for deployment progress and errors.

---

## License

MIT License - feel free to modify and distribute as needed.
