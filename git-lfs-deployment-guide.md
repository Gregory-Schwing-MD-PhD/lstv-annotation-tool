# 📦 Git LFS Setup & Deployment Guide

## What is Git LFS?

**Git Large File Storage (LFS)** replaces large files (like DICOM images) with text pointers in Git, while storing the actual files on a remote server. This is essential because:

- Regular Git stores every version of every file
- DICOM files are binary and can't be diffed
- 283 studies × ~50MB = ~14GB would make repo unusable
- Git LFS stores files efficiently and downloads on-demand

---

## Step 1: Install Git LFS (5 minutes)

### On Linux (WSU cluster):
```bash
# Check if already installed
git lfs version

# If not installed, download and install
curl -s https://packagecloud.io/install/repositories/github/git-lfs/script.deb.sh | sudo bash
sudo apt-get install git-lfs

# Or if no sudo access, use conda:
conda install -c conda-forge git-lfs

# Initialize Git LFS
git lfs install
```

### Verify Installation:
```bash
git lfs version
# Should output: git-lfs/3.x.x (GitHub; linux amd64; ...)
```

---

## Step 2: Create Project Directory Structure (10 minutes)

```bash
# Navigate to your working directory
cd ~
mkdir lstv-annotation-tool
cd lstv-annotation-tool

# Create directory structure
mkdir -p data/dicoms
mkdir -p static/css
mkdir -p static/js

# Create .gitattributes file for Git LFS
cat > .gitattributes << 'EOF'
# Git LFS - Track DICOM files
*.dcm filter=lfs diff=lfs merge=lfs -text

# Also track common medical imaging formats
*.nii filter=lfs diff=lfs merge=lfs -text
*.nii.gz filter=lfs diff=lfs merge=lfs -text
EOF

echo "✅ Directory structure created"
```

---

## Step 3: Copy and Organize DICOM Files (15-30 minutes)

### 3.1 Copy DICOM Files

```bash
# Copy entire DICOM directory structure
# This preserves study_id/series_id organization
cp -r /wsu/home/go/go24/go2432/lstv-uncertainty-detection/data/raw/train_images/* data/dicoms/

# Verify structure
ls data/dicoms/ | head -5
# Should show study_id directories: 4003253  4646740  etc.

# Check a series directory
ls data/dicoms/4003253/
# Should show series_id directories
```

### 3.2 Verify File Organization

```bash
# Count studies
echo "Total studies: $(ls -d data/dicoms/*/ | wc -l)"

# Count series
echo "Total series: $(find data/dicoms -type d -mindepth 2 -maxdepth 2 | wc -l)"

# Count DICOM files
echo "Total DICOM files: $(find data/dicoms -name "*.dcm" | wc -l)"

# Check total size
du -sh data/dicoms/
```

Expected output:
```
Total studies: 283
Total series: ~400-500
Total DICOM files: ~20,000-30,000
Total size: ~12-15GB
```

### 3.3 Optional: Rename Files to Sequential Numbers

If your DICOM files have random names, standardize them:

```bash
cd data/dicoms

# Script to rename all DICOM files to 001.dcm, 002.dcm, etc.
for study_dir in */; do
    echo "Processing study: $study_dir"
    for series_dir in "$study_dir"*/; do
        counter=1
        for dcm_file in "$series_dir"*.dcm; do
            [ -f "$dcm_file" ] || continue
            new_name=$(printf "%03d.dcm" $counter)
            
            # Only rename if different
            if [ "$(basename "$dcm_file")" != "$new_name" ]; then
                mv "$dcm_file" "$series_dir$new_name"
            fi
            ((counter++))
        done
    done
done

cd ../..
echo "✅ Files renamed"
```

---

## Step 4: Generate Metadata JSON (5 minutes)

```bash
# Make script executable
chmod +x generate_metadata.py

# Run metadata generation
python generate_metadata.py \
  /wsu/home/go/go24/go2432/lstv-uncertainty-detection/data/raw/train_series_descriptions.csv \
  /wsu/home/go/go24/go2432/lstv-uncertainty-detection/models/valid_id.npy \
  data/dicoms/

# Verify output
cat data/study_metadata.json | head -30

# Should show JSON with studies and series information
```

Expected output:
```json
{
  "version": "1.0",
  "generated_at": "2025-02-14T...",
  "total_studies": 283,
  "total_series": 450,
  "studies": [
    {
      "study_id": 4003253,
      "series": [
        {
          "series_id": 702807833,
          "description": "SAG T2",
          "slice_count": 15
        }
      ]
    }
  ]
}
```

---

## Step 5: Create GitHub Repository (10 minutes)

### 5.1 Create Repository on GitHub

1. Go to https://github.com/new
2. **Repository name**: `lstv-annotation-tool`
3. **Visibility**: **Public** (required for GitHub Pages)
4. **DO NOT** check "Initialize with README"
5. **DO NOT** add .gitignore or license
6. Click **"Create repository"**

### 5.2 Note Your Repository URL

You'll see something like:
```
https://github.com/Gregory-Schwing-MD-PhD/lstv-annotation-tool.git
```

**SAVE THIS URL** - you'll need it next!

---

## Step 6: Initialize Git Repository Locally (5 minutes)

```bash
cd ~/lstv-annotation-tool

# Initialize Git
git init
echo "✅ Git initialized"

# Configure Git LFS
git lfs install
echo "✅ Git LFS configured"

# Verify LFS tracking
git lfs track
# Should show: Tracking "*.dcm"

# Check Git status
git status
# Should show all your files as untracked
```

---

## Step 7: Add Files to Git (10 minutes)

```bash
# Stage all files (this will take a few minutes)
echo "📦 Staging files... (this may take 2-3 minutes)"
git add .

# Verify LFS is tracking DICOM files
git lfs ls-files
# Should show your .dcm files with LFS tracking

# Check what's staged
git status
# Should show:
#   new file: .gitattributes
#   new file: data/study_metadata.json
#   new file: data/dicoms/... (many files)
#   new file: static/...
#   new file: index.html
#   etc.

echo "✅ Files staged"
```

---

## Step 8: First Commit (5 minutes)

```bash
# Create initial commit
git commit -m "Initial commit: LSTV annotation tool with DICOM files via Git LFS"

# Verify commit
git log --oneline
# Should show your commit

# Check LFS files in commit
git lfs ls-files
# Should show all DICOM files

echo "✅ Initial commit created"
```

---

## Step 9: Connect to GitHub (2 minutes)

```bash
# Add remote (replace with YOUR username)
git remote add origin https://github.com/Gregory-Schwing-MD-PhD/lstv-annotation-tool.git

# Verify remote
git remote -v
# Should show:
#   origin  https://github.com/Gregory-Schwing-MD-PhD/lstv-annotation-tool.git (fetch)
#   origin  https://github.com/Gregory-Schwing-MD-PhD/lstv-annotation-tool.git (push)

# Rename branch to main
git branch -M main

echo "✅ Remote configured"
```

---

## Step 10: Push to GitHub (20-60 minutes)

⚠️ **THIS WILL TAKE TIME** - uploading ~14GB of DICOMs via LFS

```bash
# Push to GitHub
echo "🚀 Pushing to GitHub... (this will take 20-60 minutes)"
echo "Progress will be shown below. DO NOT INTERRUPT."
echo ""

git push -u origin main

# You'll see output like:
# Uploading LFS objects: 100% (20000/20000), 14 GB | 5.2 MB/s, done.
# Enumerating objects: 25000, done.
# Writing objects: 100% (25000/25000), 15 MB | 8 MB/s, done.
```

### What's Happening:

1. **Git LFS uploads** all DICOM files (~14GB) to GitHub LFS storage
2. **Git pushes** the repository structure and metadata
3. Progress bars show upload status

### If Upload Fails:

```bash
# Resume push
git push -u origin main

# Git LFS will resume from where it left off
# It's smart enough not to re-upload files already sent
```

### Monitor Upload Progress:

In another terminal:
```bash
# Watch Git LFS cache
du -sh ~/.git-lfs/

# Or check network usage
iftop  # or nethogs
```

---

## Step 11: Verify Upload (5 minutes)

### 11.1 Check GitHub Repository

1. Go to: `https://github.com/Gregory-Schwing-MD-PhD/lstv-annotation-tool`
2. You should see:
   - ✅ `index.html`
   - ✅ `static/` directory
   - ✅ `data/` directory
   - ✅ `.gitattributes` file

### 11.2 Verify Git LFS

1. Click on `data/dicoms/` → any study → any series → any `.dcm` file
2. You should see:
   - File says "Stored with Git LFS"
   - Shows LFS pointer instead of full file
   - Has "Download" button

Example LFS pointer:
```
version https://git-lfs.github.com/spec/v1
oid sha256:abc123...
size 524288
```

### 11.3 Check Repository Size

On GitHub repo main page:
- Look for: "X GB" near the repo name
- Should show ~14GB (or whatever your DICOM total is)

---

## Step 12: Enable GitHub Pages (5 minutes)

### 12.1 Configure Pages

1. In your repo, click **"Settings"** tab
2. Left sidebar → **"Pages"**
3. Under **"Source"**:
   - Branch: `main`
   - Folder: `/ (root)`
4. Click **"Save"**

### 12.2 Wait for Deployment

- GitHub will build your site (~2-3 minutes)
- Refresh the Pages settings page
- You'll see: ✅ "Your site is live at https://gregory-schwing-md-phd.github.io/lstv-annotation-tool/"

---

## Step 13: Configure Firebase in Your Deployed App (10 minutes)

### 13.1 Edit config.js on GitHub

1. Go to your repo
2. Navigate to: `static/js/config.js`
3. Click pencil icon (Edit)
4. **Replace** the entire file contents with:

```javascript
// Firebase Configuration
// Replace with your actual Firebase config from firebase-config.txt

const firebaseConfig = {
    apiKey: "YOUR_ACTUAL_API_KEY_HERE",
    authDomain: "lstv-annotation-tool.firebaseapp.com",
    projectId: "lstv-annotation-tool",
    storageBucket: "lstv-annotation-tool.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Initialize Firestore
const db = firebase.firestore();

// Initialize Auth
const auth = firebase.auth();
const googleProvider = new firebase.auth.GoogleAuthProvider();
```

5. **Paste YOUR actual values** from `firebase-config.txt`
6. Commit message: "Configure Firebase credentials"
7. Click **"Commit changes"**

### 13.2 Wait for Re-deployment

GitHub Pages will auto-redeploy (~1 minute)

---

## Step 14: Authorize Domain in Firebase (3 minutes)

### 14.1 Add GitHub Pages Domain

1. Go to Firebase Console
2. **Authentication** → **Settings** tab
3. Scroll to **"Authorized domains"**
4. Click **"Add domain"**
5. Enter: `gregory-schwing-md-phd.github.io`
6. Click **"Add"**

Wait 1-2 minutes for changes to propagate.

---

## Step 15: TEST YOUR DEPLOYMENT! 🎉

### 15.1 Access Your Site

Open: https://gregory-schwing-md-phd.github.io/lstv-annotation-tool/

### 15.2 Test Authentication

1. Click **"Sign in with Google"**
2. Choose your Google account
3. Grant permissions
4. Should redirect to annotation interface

### 15.3 Test DICOM Loading

1. Wait for "Loading study from GitHub..."
2. DICOM images should appear in viewer
3. Try:
   - **Mouse wheel**: Scroll through slices
   - **Click + drag**: Adjust window/level
   - **Arrow keys**: Navigate

### 15.4 Test Annotation

1. Scroll through the study
2. Select a Castellvi type
3. Add notes (optional)
4. Click **"Submit Annotation"**
5. Next study should load automatically

---

## ✅ Deployment Complete!

Your LSTV annotation tool is now:

- ✅ **Live** at your GitHub Pages URL
- ✅ **Storing** DICOMs in Git LFS (~14GB)
- ✅ **Authenticated** with Google OAuth
- ✅ **Tracking** annotations in Firebase Firestore
- ✅ **Ready** for your radiologist reviewers

---

## 📊 Git LFS Bandwidth & Storage

### Free Tier:
- **Storage**: 1GB free
- **Bandwidth**: 1GB/month free

### Your Usage:
- **Storage**: ~14GB = **$13/month** ($5/50GB beyond free 1GB)
- **Bandwidth**: ~50-100MB per user per month

### Cost Estimate:
- **Monthly**: ~$13/month for storage
- **Per user**: Negligible bandwidth (users only download what they view)

### To Monitor Usage:
1. GitHub → Settings → Billing → Git LFS Data
2. See storage and bandwidth usage

---

## 🔄 Making Updates After Deployment

### Update Code (HTML/CSS/JS):
```bash
# Edit files locally
nano static/css/style.css

# Commit and push
git add static/css/style.css
git commit -m "Update styling"
git push

# GitHub Pages auto-redeploys in ~1 minute
```

### Add More DICOM Files:
```bash
# Copy new files
cp -r /path/to/new_dicoms/* data/dicoms/

# Regenerate metadata
python generate_metadata.py ...

# Commit and push (Git LFS handles large files)
git add data/
git commit -m "Add new DICOM studies"
git push  # This will upload new DICOMs via LFS
```

---

## 🐛 Troubleshooting

### Git LFS Upload Fails
```bash
# Check Git LFS installation
git lfs version

# Verify tracking
git lfs track

# Try pushing again (resumes from where it stopped)
git push
```

### "File too large" Error
```bash
# This means Git LFS isn't tracking the file
# Check .gitattributes
cat .gitattributes

# Should show: *.dcm filter=lfs diff=lfs merge=lfs -text

# If missing, add it and recommit
echo "*.dcm filter=lfs diff=lfs merge=lfs -text" >> .gitattributes
git add .gitattributes
git commit --amend
```

### GitHub Pages Not Updating
```bash
# Check deployment status
# GitHub repo → Actions tab
# Should show "pages build and deployment" workflows

# Force rebuild by making a small change
echo "<!-- refresh -->" >> index.html
git commit -am "Force rebuild"
git push
```

---

## 📞 Need Help?

Check:
1. **Git LFS**: https://git-lfs.github.com/
2. **GitHub Pages**: https://pages.github.com/
3. **Firebase**: https://console.firebase.google.com/

Common issues are usually:
- Git LFS not installed properly
- .gitattributes missing or incorrect
- Firebase domain not authorized

---

**🎉 You're all set! Your professional DICOM annotation tool is live!**
