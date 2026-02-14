# 🔥 Firebase Setup Guide - LSTV Annotation Tool

## Step 1: Create Firebase Project (5 minutes)

### 1.1 Create Project
1. **Open browser** → https://console.firebase.google.com
2. **Click**: Blue "Add project" or "Create a project" button
3. **Project name**: `lstv-annotation-tool`
4. **Click**: "Continue"
5. **Google Analytics**: Toggle OFF (we don't need it)
6. **Click**: "Create project"
7. **Wait**: ~30 seconds for project creation
8. **Click**: "Continue" when ready

---

## Step 2: Enable Google Authentication (3 minutes)

### 2.1 Navigate to Authentication
1. In the left sidebar, find **"Build"** section
2. **Click**: "Authentication"
3. **Click**: Blue "Get started" button

### 2.2 Enable Google Sign-In
1. **Click** the "Google" provider row (has Google logo)
2. **Toggle ON**: "Enable" switch at top right
3. **Project support email**: Select your email from dropdown
4. **Public-facing name**: Leave as "lstv-annotation-tool"
5. **Project support email** (second one): Same email
6. **Click**: "Save"

✅ You should see "Google" status as "Enabled" now

---

## Step 3: Create Firestore Database (4 minutes)

### 3.1 Create Database
1. Left sidebar → **"Firestore Database"** (under "Build")
2. **Click**: "Create database" button
3. **Mode**: Select "Start in **production mode**" (important!)
4. **Click**: "Next"

### 3.2 Choose Location
1. **Location**: Select "us-central (Iowa)" or closest to you:
   - **us-central** (Iowa) - Best for US East/Central
   - **us-west1** (Oregon) - Best for US West
   - **europe-west** (Belgium) - Best for Europe
2. **Click**: "Enable"
3. **Wait**: ~1 minute for database creation

### 3.3 Set Security Rules
1. You should now see the Firestore console
2. **Click**: "Rules" tab at the top
3. **DELETE** everything in the rules editor
4. **PASTE** this exactly:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Annotations collection
    match /annotations/{annotationId} {
      // Anyone authenticated can read
      allow read: if request.auth != null;
      
      // Only authenticated users can create annotations
      // And only with their own email
      allow create: if request.auth != null 
        && request.resource.data.user_email == request.auth.token.email;
      
      // No updates or deletes (immutable annotations)
      allow update, delete: if false;
    }
  }
}
```

5. **Click**: Blue "Publish" button at top
6. **Wait**: Rules should show "Published" with green checkmark

---

## Step 4: Get Your Firebase Configuration (3 minutes)

### 4.1 Navigate to Project Settings
1. **Click**: Gear icon ⚙️ (top left, next to "Project Overview")
2. **Click**: "Project settings"
3. Scroll down to **"Your apps"** section
4. You should see "There are no apps in your project"

### 4.2 Register Web App
1. **Click**: Web icon `</>` (looks like code brackets)
2. **App nickname**: `lstv-annotation-tool`
3. **Firebase Hosting**: Leave UNCHECKED (we're using GitHub Pages)
4. **Click**: Blue "Register app" button
5. **Wait**: App registers (~5 seconds)

### 4.3 Copy Configuration
1. You'll see a code block titled "Add Firebase SDK"
2. **IMPORTANT**: Copy ONLY the `firebaseConfig` object

It looks like this:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyD-XXXXXXXXXXXXXXXXXXXXXXXXXXX",
  authDomain: "lstv-annotation-tool.firebaseapp.com",
  projectId: "lstv-annotation-tool",
  storageBucket: "lstv-annotation-tool.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef1234567890"
};
```

3. **COPY THIS ENTIRE BLOCK** - paste it into a text file
4. **SAVE AS**: `firebase-config.txt` on your desktop
5. **Click**: "Continue to console"

---

## ✅ Firebase Setup Complete!

You should now have:
- ✅ Firebase project created
- ✅ Google authentication enabled
- ✅ Firestore database created with security rules
- ✅ Your firebaseConfig saved

### What You Have:
- **Project ID**: `lstv-annotation-tool`
- **Firebase Config**: Saved in `firebase-config.txt`

---

## 🔍 Verification Checklist

Before moving to next phase, verify:

1. **Authentication**:
   - Go to Authentication → Sign-in method
   - Google should show "Enabled"

2. **Firestore**:
   - Go to Firestore Database → Data tab
   - Should see empty database (this is correct)
   - Go to Rules tab → Should see your custom rules

3. **Configuration**:
   - You have `firebase-config.txt` saved with your config

---

## ⚠️ Important Notes

1. **NEVER commit firebase-config.txt to Git** (it contains your API key)
2. **The API key is PUBLIC** - it's meant to be in client-side code
3. Security comes from Firestore Rules (which we configured)
4. Keep the Firebase console tab open - you'll need it later

---

## Next Steps

After Firebase setup is complete, you'll:
1. ✅ Setup your local Git repository
2. ✅ Generate metadata for your DICOM files
3. ✅ Configure Git LFS for large file storage
4. ✅ Deploy to GitHub Pages

Ready to continue? Let me know when Firebase setup is complete!
