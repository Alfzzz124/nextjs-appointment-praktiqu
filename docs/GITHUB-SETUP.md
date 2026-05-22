# PraktiQU GitHub Repository Setup

This document contains instructions for setting up the PraktiQU GitHub repository and configuring GitHub integration.

---

## Repository Information

**Repository Name:** PraktiQU
**Organization:** PraktiQU
**GitHub URL:** https://github.com/PraktiQU/praktiqu

---

## GitHub Setup Checklist

- [ ] Create GitHub repository named `praktiqu`
- [ ] Add repository description: "Next.js Clinic Management System (EHR)"
- [ ] Initialize with README.md
- [ ] Add .gitignore for Node.js/Next.js
- [ ] Configure branch protection rules
- [ ] Set up labels for issue tracking
- [ ] Add repository topics: `nextjs`, `clinic-management`, `healthcare`, `ehr`, `appointment-booking`

---

## GitHub MCP Server Setup

### Prerequisites

1. GitHub Personal Access Token (PAT)
   - Go to: https://github.com/settings/tokens
   - Create new token with `repo` scope

2. Install GitHub CLI (optional but recommended)
   - macOS: `brew install gh`
   - Windows: `winget install GitHub.cli`

### Configure MCP Server

Create/update your MCP configuration file:

#### Windows: `%USERPROFILE%\.claude\mcp-settings.json`
#### macOS/Linux: `~/.claude/mcp-settings.json`

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "your-personal-access-token-here"
      }
    }
  }
}
```

### Alternative: Using GitHub CLI

```json
{
  "mcpServers": {
    "github": {
      "command": "gh",
      "args": ["api", "graphql"],
      "env": {
        "GITHUB_TOKEN": "your-personal-access-token-here"
      }
    }
  }
}
```

---

## GitHub Actions Workflow Setup

The repository includes CI/CD workflows in `.github/workflows/`. Ensure the following secrets are configured in GitHub:

### Required Secrets

| Secret Name | Description |
|-------------|-------------|
| `DATABASE_URL` | PostgreSQL connection string for CI |
| `NEXTAUTH_SECRET` | Secret for NextAuth.js |

### Optional Secrets

| Secret Name | Description |
|-------------|-------------|
| `NODE_ENV` | Environment (production/staging) |

---

## Initial Repository Setup Commands

```bash
# Clone the repository
git clone git@github.com:PraktiQU/praktiqu.git
cd praktiqu

# Add upstream (if needed)
git remote add upstream git@github.com:PraktiQU/praktiqu.git

# Verify remote
git remote -v

# Push initial code
git push -u origin main
```

---

## Branch Strategy

| Branch | Purpose | Protection |
|--------|---------|------------|
| `main` | Production-ready code | Required PR + 1 review |
| `develop` | Development integration | Required PR |
| `feature/*` | Feature branches | Self-reviewed |

---

## Labels for Issue Tracking

Create these labels in your GitHub repository:

| Label | Color | Description |
|-------|-------|-------------|
| `enhancement` | #a2eeef | New feature request |
| `bug` | #d73a4a | Bug report |
| `documentation` | #0075ca | Documentation updates |
| `question` | #d876e3 | Questions/discussions |
| `help wanted` | #008672 | Need assistance |
| `good first issue` | #7057ff | Good for newcomers |
| `priority:high` | #ff0000 | High priority |
| `priority:medium` | #ffa500 | Medium priority |
| `priority:low` | #90EE90 | Low priority |

---

## Repository Features

Enable these features in your GitHub repository settings:

- [x] Issues
- [x] Discussions
- [x] Projects (for Kanban-style tracking)
- [x] Wikis (for documentation)
- [x] Preset labels
- [x] Welcome message for contributors

---

## Next Steps After Repository Creation

1. Push all local files to GitHub
2. Create initial project board
3. Create first milestone (MVP)
4. Open issues from the project plan
5. Assign initial tasks

---

## Resources

- [GitHub Documentation](https://docs.github.com/)
- [GitHub Actions](https://docs.github.com/en/actions)
- [MCP Server GitHub](https://github.com/modelcontextprotocol/servers/tree/main/src/github)