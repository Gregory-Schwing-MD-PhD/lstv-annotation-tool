# 🚀 LSTV Annotation Tool - Complete Deployment Instructions

## 📋 What You Have

You now have all the files needed for your LSTV annotation tool:

### Web Application Files:
- `index.html` - Main annotation interface
- `login.html` - Login page
- `static/css/style.css` - Complete styling
- `static/js/config.js` - Firebase configuration (TO BE EDITED)
- `static/js/auth.js` - Authentication module
- `static/js/storage.js` - Firebase Storage handler
- `static/js/viewer.js` - DICOM viewer (Cornerstone.js)
- `static/js/annotations.js` - Annotations manager
- `static/js/app.js` - Main application logic

### Python Scripts:
- `upload_dicoms.py` - Upload DICOMs to Firebase Storage

---

## 🎯 Deployment Steps

### ✅ **STEP 1: Complete Firebase Setup (15 minutes)**

Follow the guide in `firebase-setup-guide.md`:

1. Create Firebase project
2. Enable Google Authentication
3. Enable Firebase Storage
4. Create Firestore Database
5. Set security rules
6. Get Firebase configuration
7. Create service account key

**Checklist:**
- [ ] Firebase project created
- [ ] Google auth enabled
- [ ] Storage enabled with rules
- [ ] Firestore enabled with rules
- [ ] Firebase config saved to `firebase-config.txt`
- [ ] Service account key downloaded

---

### ✅ **STEP 2: Prepare Local Environment (10 minutes)**

```bash
# Install Python dependencies
pip install --user firebase-admin pydicom pandas numpy

# Create project directory
mkdir ~/lstv-annotation-tool
cd ~/lstv-annotation-tool

# Copy web application files
# (Copy all the webapp files you received)

# Copy Python scripts
# (Copy upload_dicoms.py)

# Create necessary directories
mkdir -p scripts
mkdir -p temp_dicoms

# Copy service account key
cp ~/Downloads/lstv-annotation-tool-*.json scripts/firebase-service-account.json

# ⚠️ IMPORTANT: Add to .gitignore
echo "scripts/firebase-service-account.json" >> .gitignore
```

---

### ✅ **STEP 3: Trial Upload (3 Studies) (20 minutes)**

```bash
# Copy 3 trial studies
cp -r /wsu/home/go/go24/go2432/lstv-uncertainty-detection/data/raw/train_images/4003253 temp_dicoms/
cp -r /wsu/home/go/go24/go2432/lstv-uncertainty-detection/data/raw/train_images/4646740 temp_dicoms/
cp -r /wsu/home/go/go24/go2432/lstv-uncertainty-detection/data/raw/train_images/4712163 temp_dicoms/

# Verify files copied
ls temp_dicoms/
find temp_dicoms -name "*.dcm" | wc -l

# Run trial upload
python upload_dicoms.py scripts/firebase-service-account.json temp_dicoms/ --trial
```

**What happens:**
- Uploads 3 studies to Firebase Storage
- Creates metadata in Firestore
- Generates `data/study_metadata.json`

**Verify in Firebase Console:**
1. Go to Firebase Console → Storage
2. Check `dicoms/` folder has your studies
3. Go to Firestore → Check `studies` collection

---

### ✅ **STEP 4: Configure Firebase in Web App (5 minutes)**

Edit `static/js/config.js`:

```javascript
// Replace with YOUR Firebase config from firebase-config.txt
const firebaseConfig = {
    apiKey: "AIzaSy...",  // YOUR ACTUAL API KEY
    authDomain: "lstv-annotation-tool.firebaseapp.com",
    projectId: "lstv-annotation-tool",
    storageBucket: "lstv-annotation-tool.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abc123"
};
```

Save the file.

---

### ✅ **STEP 5: Setup GitHub Repository (10 minutes)**

```bash
cd ~/lstv-annotation-tool

# Initialize git
git init

# Create .gitignore
cat > .gitignore << 'EOF'
# Firebase service account (NEVER commit this!)
scripts/firebase-service-account.json
scripts/*.json

# Temporary DICOM files
temp_dicoms/

# macOS
.DS_Store

# Editor files
.vscode/
.idea/
EOF

# Add all files
git add .

# First commit
git commit -m "Initial commit: LSTV annotation tool"

# Create repo on GitHub:
# Go to https://github.com/new
# Repository name: lstv-annotation-tool
# Visibility: Public (required for GitHub Pages)
# DO NOT initialize with README

# Add remote (replace with YOUR username)
git remote add origin https://github.com/YOUR_USERNAME/lstv-annotation-tool.git

# Push to GitHub
git branch -M main
git push -u origin main
```

---

### ✅ **STEP 6: Enable GitHub Pages (5 minutes)**

1. Go to your GitHub repo
2. Click **Settings** tab
3. Click **Pages** (left sidebar)
4. **Source**: 
   - Branch: `main`
   - Folder: `/ (root)`
5. Click **Save**
6. Wait 2-3 minutes for deployment
7. Your site will be live at: `https://YOUR_USERNAME.github.io/lstv-annotation-tool/`

---

### ✅ **STEP 7: Authorize GitHub Pages Domain (3 minutes)**

1. Go to Firebase Console
2. **Authentication** → **Settings** → **Authorized domains**
3. Click **Add domain**
4. Enter: `YOUR_USERNAME.github.io`
5. Click **Add**
6. Wait 1-2 minutes

---

### ✅ **STEP 8: Test the Application (10 minutes)**

1. **Open your site**: `https://YOUR_USERNAME.github.io/lstv-annotation-tool/`

2. **Test login**:
   - Click "Sign in with Google"
   - Authenticate with your Google account
   - Should redirect to main app

3. **Test DICOM loading**:
   - Wait for study to load (first load may take 30-60 seconds)
   - Should see DICOM images in viewer
   - Try scrolling with mouse wheel
   - Try adjusting window/level by dragging

4. **Test annotation**:
   - Select a Castellvi type
   - Select confidence level
   - Add optional notes
   - Click "Submit Annotation"
   - Should load next study

5. **Verify in Firebase**:
   - Go to Firestore → `annotations` collection
   - Should see your annotation

✅ **If all tests pass, proceed to full upload!**

---

### ✅ **STEP 9: Full DICOM Upload (2-4 hours)**

**IMPORTANT**: This will take several hours. Run in a screen/tmux session!

```bash
# Start screen session
screen -S dicom_upload

# Run full upload
python upload_dicoms.py \
  scripts/firebase-service-account.json \
  /wsu/home/go/go24/go2432/lstv-uncertainty-detection/data/raw/train_images/

# Monitor progress
# The script will show:
# - Current study being uploaded
# - Files uploaded per series
# - Total progress

# Detach from screen: Ctrl+A, then D
# Reattach: screen -r dicom_upload
```

**What happens:**
- Uploads all 283 validation studies (~14GB)
- Creates metadata for each study in Firestore
- Generates complete `data/study_metadata.json`
- Progress is saved - if interrupted, restart and it will resume

**Expected time**: 2-4 hours depending on:
- Internet upload speed
- Number of DICOM files
- Server response time

---

### ✅ **STEP 10: Update GitHub with Metadata (5 minutes)**

After upload completes:

```bash
# Add updated metadata
git add data/study_metadata.json

# Commit
git commit -m "Add complete study metadata for all 283 studies"

# Push to GitHub
git push

# GitHub Pages will auto-redeploy in ~1 minute
```

---

## 🎉 **DEPLOYMENT COMPLETE!**

Your LSTV annotation tool is now:

✅ **Live** at: `https://YOUR_USERNAME.github.io/lstv-annotation-tool/`  
✅ **Storing** 14GB of DICOMs in Firebase Storage  
✅ **Authenticated** with Google OAuth  
✅ **Tracking** annotations in Firestore  
✅ **Ready** for radiologists to use  

---

## 👥 **Share with Radiologists**

Send them:

```
URL: https://YOUR_USERNAME.github.io/lstv-annotation-tool/

Instructions:
1. Visit the URL
2. Click "Sign in with Google"
3. Review DICOM images using:
   - Mouse wheel: Scroll slices
   - Click + drag: Adjust window/level
   - Arrow keys: Navigate
4. Select Castellvi classification
5. Submit annotation
6. Next study loads automatically
```

---

## 📊 **Monitor Progress**

### View Annotations:
1. Firebase Console → Firestore → `annotations` collection
2. See all submitted annotations

### Export to CSV (Browser Console):
```javascript
db.collection('annotations').get().then(snapshot => {
    const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    }));
    
    const csv = [
        'ID,Study ID,Type,Confidence,User,Email,Notes,Timestamp',
        ...data.map(row => [
            row.id,
            row.study_id,
            row.castellvi_type,
            row.confidence,
            row.user_name,
            row.user_email,
            '"' + (row.notes || '').replace(/"/g, '""') + '"',
            row.timestamp?.toDate().toISOString() || ''
        ].join(','))
    ].join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lstv-annotations-' + new Date().toISOString().split('T')[0] + '.csv';
    a.click();
});
```

---

## 💰 **Monthly Costs**

### Firebase:
- **Storage**: ~14GB × $0.026/GB = **$0.36/month**
- **Bandwidth**: ~10-20GB × $0.12/GB = **$1.20-$2.40/month**
- **Authentication**: Free
- **Firestore**: Free (under limits)

**Total: ~$2-3/month** (99% cheaper than Git LFS!)

---

## 🔄 **Making Updates**

### Update Code:
```bash
# Edit files locally
nano static/css/style.css

# Commit and push
git add static/css/style.css
git commit -m "Update styling"
git push

# GitHub Pages auto-redeploys in ~1 minute
```

### Add More Studies:
```bash
# Upload new DICOMs
python upload_dicoms.py scripts/firebase-service-account.json /path/to/new/studies/

# Update metadata in git
git add data/study_metadata.json
git commit -m "Add new studies"
git push
```

---

## 🐛 **Troubleshooting**

### DICOMs Not Loading:
- Check Firebase Storage → Verify files exist
- Check browser console (F12) for errors
- Verify storage security rules are correct

### Authentication Issues:
- Verify GitHub Pages domain in Firebase authorized domains
- Check Firebase Authentication is enabled
- Try incognito/private browsing

### Upload Fails:
```bash
# Check service account key
ls -l scripts/firebase-service-account.json

# Verify Firebase project ID matches
cat scripts/firebase-service-account.json | grep project_id

# Try uploading one study manually
python upload_dicoms.py scripts/firebase-service-account.json temp_dicoms/4003253/ --trial
```

---

## 📞 **Support**

Common issues:
1. Check browser console (F12) for JavaScript errors
2. Verify Firebase Console for data
3. Check GitHub Pages deployment status
4. Review Firebase security rules

---

**🎊 Congratulations! Your professional LSTV annotation tool is deployed and ready!**
