# 🚀 LSTV Annotation Tool - Firebase Storage Deployment Guide

## 🎯 **Architecture Overview (REVISED)**

### What Changed:
- ❌ **OLD**: DICOMs stored in Git LFS (expensive, slow)
- ✅ **NEW**: DICOMs stored in Firebase Storage (fast, scalable, cheaper)

### Benefits of Firebase Storage:
- ✅ **Faster loading**: Direct CDN delivery
- ✅ **Cheaper**: $0.026/GB storage vs Git LFS $5/50GB
- ✅ **Progressive loading**: Stream images as needed
- ✅ **Better security**: Firebase security rules
- ✅ **No repo bloat**: Git stays lightweight

---

## 📊 **System Architecture**

```
Radiologist Browser
       │
       ├─── GitHub Pages (HTML/CSS/JS only, ~5MB)
       │
       ├─── Firebase Authentication (Google OAuth)
       │
       ├─── Firebase Storage (DICOMs, ~14GB)
       │
       └─── Firebase Firestore (Annotations database)
```

**Key Point**: Only code lives in GitHub. All data lives in Firebase.

---

## 💰 **Cost Breakdown**

### Firebase Free Tier:
- Storage: **5GB free**, then $0.026/GB/month
- Downloads: **1GB/day free**, then $0.12/GB
- Authentication: **Free** (unlimited)
- Firestore: **1GB storage free**, 50K reads/day

### Your Estimated Costs (14GB DICOMs):
- **Storage**: 14GB × $0.026 = **$0.36/month**
- **Bandwidth**: ~10GB/month × $0.12 = **$1.20/month**
- **Total**: **~$2/month** (vs $13/month with Git LFS)

---

## 📁 **Directory Structure**

```
lstv-annotation-tool/
├── index.html                    # Main app page
├── login.html                    # Login page
├── README.md                     # Documentation
│
├── static/
│   ├── css/
│   │   └── style.css
│   ├── js/
│   │   ├── config.js            # Firebase config
│   │   ├── auth.js              # Authentication logic
│   │   ├── storage.js           # Firebase Storage handler
│   │   ├── viewer.js            # DICOM viewer (Cornerstone.js)
│   │   └── annotations.js       # Annotation logic
│   └── images/
│       └── logo.png
│
├── scripts/
│   ├── upload_dicoms.py         # Upload DICOMs to Firebase
│   └── generate_metadata.py     # Generate study metadata
│
└── data/
    └── study_metadata.json      # Study/series metadata (lightweight)
```

**Note**: `data/dicoms/` folder is NOT in Git! DICOMs go to Firebase Storage.

---

## 🔥 **PHASE 1: Firebase Setup (15 minutes)**

### Step 1: Create Firebase Project

1. Go to https://console.firebase.google.com
2. Click **"Add project"**
3. Project name: `lstv-annotation-tool`
4. Disable Google Analytics
5. Click **"Create project"** → Wait ~30 seconds
6. Click **"Continue"**

---

### Step 2: Enable Google Authentication

1. Left sidebar → **"Authentication"**
2. Click **"Get started"**
3. Click **"Google"** provider
4. Toggle **"Enable"** ON
5. Select your support email
6. Click **"Save"**

✅ Google sign-in is now enabled

---

### Step 3: Enable Firebase Storage

1. Left sidebar → **"Storage"**
2. Click **"Get started"**
3. **Mode**: Select **"Start in production mode"**
4. Click **"Next"**
5. **Location**: Select **us-central** (or nearest)
6. Click **"Done"**
7. Wait ~1 minute for storage to initialize

---

### Step 4: Set Storage Security Rules

1. In Storage console, click **"Rules"** tab
2. **Replace** everything with this:

```javascript
rules_version = '2';

service firebase.storage {
  match /b/{bucket}/o {
    // DICOMs - authenticated users can read
    match /dicoms/{study_id}/{series_id}/{filename} {
      allow read: if request.auth != null;
      allow write: if false;  // Only admin uploads
    }
    
    // Allow admin uploads (we'll use service account)
    match /{allPaths=**} {
      allow read: if request.auth != null;
      allow write: if false;
    }
  }
}
```

3. Click **"Publish"**

**What this does**:
- ✅ Authenticated users can read DICOMs
- ❌ No one can write via web app (prevents tampering)
- ✅ Admin (you) can upload via service account

---

### Step 5: Create Firestore Database

1. Left sidebar → **"Firestore Database"**
2. Click **"Create database"**
3. Mode: **"Start in production mode"**
4. Location: **us-central** (same as Storage)
5. Click **"Enable"**

---

### Step 6: Set Firestore Security Rules

1. Click **"Rules"** tab
2. **Replace** with:

```javascript
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    // Study metadata - everyone can read
    match /studies/{studyId} {
      allow read: if request.auth != null;
      allow write: if false;
    }
    
    // Annotations - authenticated users can create
    match /annotations/{annotationId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null 
        && request.resource.data.user_email == request.auth.token.email;
      allow update, delete: if false;  // Immutable
    }
    
    // User progress tracking
    match /user_progress/{userId} {
      allow read, write: if request.auth != null 
        && request.auth.uid == userId;
    }
  }
}
```

3. Click **"Publish"**

---

### Step 7: Get Firebase Config

1. Click **⚙️ (Settings)** → **"Project settings"**
2. Scroll to **"Your apps"**
3. Click **Web icon `</>`**
4. App nickname: `lstv-annotation-tool`
5. **Firebase Hosting**: Leave UNCHECKED
6. Click **"Register app"**
7. **COPY** the `firebaseConfig` object:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "lstv-annotation-tool.firebaseapp.com",
  projectId: "lstv-annotation-tool",
  storageBucket: "lstv-annotation-tool.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

8. **SAVE** this to `firebase-config.txt` on your desktop

---

### Step 8: Create Service Account for Upload

1. **Project settings** → **"Service accounts"** tab
2. Click **"Generate new private key"**
3. Click **"Generate key"**
4. A JSON file downloads: `lstv-annotation-tool-xxxxx.json`
5. **SAVE THIS FILE** - you'll need it to upload DICOMs
6. **⚠️ KEEP THIS SECRET** - it's like a password

---

## ✅ **Firebase Setup Complete!**

You now have:
- ✅ Firebase project created
- ✅ Google Authentication enabled
- ✅ Firebase Storage with security rules
- ✅ Firestore with security rules
- ✅ Firebase config saved
- ✅ Service account key for uploads

---

## 📦 **PHASE 2: Prepare Local Environment (10 minutes)**

### Step 1: Install Python Dependencies

```bash
# On WSU cluster
pip install --user firebase-admin pydicom pandas numpy

# Or with conda
conda install -c conda-forge firebase-admin pydicom pandas numpy
```

---

### Step 2: Create Project Directory

```bash
cd ~
mkdir lstv-annotation-tool
cd lstv-annotation-tool

# Create structure
mkdir -p static/css
mkdir -p static/js
mkdir -p scripts
mkdir -p data
mkdir temp_dicoms  # Temporary folder for trial upload

echo "✅ Directory structure created"
```

---

### Step 3: Copy Service Account Key

```bash
# Copy the JSON key you downloaded from Firebase
cp ~/Downloads/lstv-annotation-tool-*.json scripts/firebase-service-account.json

# Verify it exists
ls -l scripts/firebase-service-account.json

# ⚠️ IMPORTANT: Never commit this file to Git!
echo "scripts/firebase-service-account.json" > .gitignore
```

---

## 🧪 **PHASE 3: Trial Upload (Test with 3 Studies)**

Let's start by uploading just 3 studies to test the system.

### Step 1: Copy Trial Studies

```bash
cd ~/lstv-annotation-tool

# Copy just 3 studies for testing
cp -r /wsu/home/go/go24/go2432/lstv-uncertainty-detection/data/raw/train_images/4003253 temp_dicoms/
cp -r /wsu/home/go/go24/go2432/lstv-uncertainty-detection/data/raw/train_images/4646740 temp_dicoms/
cp -r /wsu/home/go/go24/go2432/lstv-uncertainty-detection/data/raw/train_images/4712163 temp_dicoms/

# Verify
ls temp_dicoms/
# Should show: 4003253  4646740  4712163

# Count files
find temp_dicoms -name "*.dcm" | wc -l
# Should show number of DICOM files
```

---

### Step 2: Create Upload Script

I'll create the Python upload script next (saving this section)...

---

## 📝 **Study Metadata Structure**

```json
{
  "study_id": 4003253,
  "series": [
    {
      "series_id": 702807833,
      "description": "SAG T2",
      "slice_count": 15,
      "storage_path": "dicoms/4003253/702807833/"
    }
  ],
  "upload_date": "2025-02-14T10:30:00Z",
  "status": "ready"
}
```

This metadata will be stored in:
- **Firestore** (for querying/filtering)
- **data/study_metadata.json** (lightweight, for GitHub repo)

---

## 🎨 **Web Application Features**

Your app will have:

1. **Login Page** (`login.html`)
   - Google sign-in button
   - Simple, professional design

2. **Annotation Interface** (`index.html`)
   - DICOM viewer (Cornerstone.js)
   - Castellvi classification selector
   - Confidence rating
   - Notes field
   - Progress tracker
   - Auto-load next study

3. **Admin Dashboard** (optional)
   - View all annotations
   - Export to CSV
   - Inter-rater agreement stats

---

## 🔄 **User Workflow**

```
1. Visit site → Login with Google
2. App checks Firestore for:
   - Studies already reviewed by this user
   - Studies needing review
3. Load next available study:
   - Fetch metadata from Firestore
   - Stream DICOM files from Firebase Storage
   - Display in Cornerstone.js viewer
4. User annotates:
   - Select Castellvi type
   - Add confidence rating
   - Add notes
5. Submit annotation:
   - Save to Firestore
   - Update user progress
   - Load next study
6. Repeat until all studies reviewed
```

---

## 📊 **Next Steps**

Now I'll create:

1. ✅ **Python upload script** - Upload DICOMs to Firebase Storage
2. ✅ **Metadata generator** - Create study metadata JSON
3. ✅ **Web application code** - HTML, CSS, JavaScript
4. ✅ **Deployment instructions** - Push to GitHub Pages

Ready to continue? Let me know when you:
- ✅ Have Firebase setup complete
- ✅ Have service account key saved
- ✅ Have 3 trial studies copied

Then I'll create the upload script and we'll do the trial upload!
