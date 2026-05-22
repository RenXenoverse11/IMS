# IMS Google Apps Script Deployment Guide

## Current Active Deployment

**Deployment ID**: `AKfycbxUD34lzTj51baP-I5lfUb9NEEgOroQXNRl0Jxe9bkn`

**Script ID**: `1PVdB32r5MwgIM5zWNLwJapeQerpk9So5-NzFE_wDykVSeQYUcVAHFEy-`

---

## For Team Members

### How to Access the Latest Version
1. Use this deployment link (replace `{DEPLOYMENT_ID}` with the ID above):
   ```
   https://script.google.com/macros/d/{DEPLOYMENT_ID}/usercache
   ```
   
2. Or use the full URL:
   ```
   https://script.google.com/macros/d/AKfycbxUD34lzTj51baP-I5lfUb9NEEgOroQXNRl0Jxe9bkn/usercache
   ```

### What's in the Latest Deployment

**Latest Features:**
- ✅ Document Filter Tabs
  - "All Documents" - View everything
  - "My Documents" - Your uploads only
  - "Shared with Me" - Documents others shared with you
- ✅ Search functionality (works with filters)
- ✅ Document management (upload, delete, share)

---

## Deployment Workflow

### For Developers (Using This Repository)

#### Step 1: Make Your Changes
- Edit files locally in your IDE
- Test thoroughly before deploying

#### Step 2: Deploy to GAS
```bash
npm run deploy:gas
```

This command:
1. Builds the project with Vite
2. Processes the output for GAS compatibility
3. Pushes all files to Google Apps Script using `clasp`

#### Step 3: Share the Deployment ID
After deploying, run:
```bash
npx clasp deployments -P appscript
```

Copy the new deployment ID and update this guide.

#### Step 4: Notify Your Team
Share the new deployment ID with teammates so they can update their bookmarks.

---

## Troubleshooting Sync Issues

### Problem: Team Members See Outdated Version

**Solution 1: Hard Refresh Browser**
- **Mac/Linux**: `Cmd + Shift + R`
- **Windows**: `Ctrl + Shift + R`
- Clear browser cache for `script.google.com`

**Solution 2: Check Deployment ID**
- Verify everyone is using the correct deployment ID
- Invalid/old IDs will load cached versions

**Solution 3: Check URL Format**
- Make sure the URL includes `/usercache` path
- Without it, you might get a different cached version

---

## Recent Deployment History

| Deployment ID | Version | Description | Date |
|---|---|---|---|
| AKfycbxUD34lzTj51baP-I5lfUb9NEEgOroQXNRl0Jxe9bkn | @HEAD | Latest - Document Filters Added | May 4, 2026 |
| AKfycbwJiEvVq0o-Zfu85lt8wbjOgaSh-C1fN4GJbxddo_7LazO-8BXzDxR14QfFZ7EJ2k8U | @48 | IMS new mobile view | Previous |

---

## Git + GAS Synchronization

### Best Practices
1. **Always update GitHub first** before deploying to GAS
   ```bash
   git add .
   git commit -m "Feature: Add document filters"
   git push origin main
   ```

2. **Then deploy to GAS**
   ```bash
   npm run deploy:gas
   ```

3. **Document the change**
   - Update this file with new deployment ID
   - Push the updated DEPLOYMENT_GUIDE.md to GitHub

### Why This Matters
- GitHub keeps your code history
- GAS keeps your live deployment
- Together they ensure team sync

---

## Quick Reference Commands

```bash
# Deploy to GAS
npm run deploy:gas

# List all deployments
npx clasp deployments -P appscript

# View the active script
npx clasp list -P appscript

# Pull latest from GitHub
git pull origin main

# Push to GitHub
git push origin main
```

---

## Questions?
Contact Errvyne or check the IMS project README for more information.
