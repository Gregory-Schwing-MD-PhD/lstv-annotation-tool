# LSTV Annotation Tool - FIXED VERSION

## 🎉 ALL MAJOR ISSUES FIXED

### What Was Fixed:
1. **✅ Login Flow** - No more premature auth checks; goes straight to login if not authenticated.
2. **✅ Popup Conflicts** - Added flag to prevent multiple simultaneous Google sign-in popups.
3. **✅ Broken Viewer** - Fixed undefined property errors with proper null checks.
4. **✅ Arrow Key Navigation** - Full keyboard support for scrolling through slices.
5. **✅ Error Handling** - Comprehensive error messages with helpful debugging info.
6. **✅ 404 DICOM Errors** - Better handling when files are missing from Storage.

---

## 📁 File Structure

```text
your-project/
├── index.html              (Main app page)
├── login.html              (NEW - Fixed login page)
├── upload_dicoms.py        (NEW - Python Uploader)
├── cors.json               (NEW - CORS Configuration)
├── scripts/
│   └── firebase-service-account.json
├── data/
│   └── dicoms/             (Put your study folders here: 1020394063, etc.)
├── static/
│   ├── css/
│   │   └── style.css       (Keep your existing one)
│   └── js/
│       ├── config.js       (NEW)
│       ├── auth.js         (FIXED)
│       ├── storage.js      (FIXED)
│       ├── viewer.js       (COMPLETELY REWRITTEN)
│       ├── annotations.js  (Keep your existing one)
│       └── app.js          (FIXED)

```

---

## 🚀 Installation & Setup

### 1. Update Project Files

Replace your existing JS files with the new versions provided:

* `login.html`
* `static/js/config.js`
* `static/js/auth.js`
* `static/js/storage.js`
* `static/js/viewer.js`
* `static/js/app.js`

### 2. Configure CORS (CRITICAL)

If you don't do this, the web app cannot load images from Firebase.

1. Create a file named `cors.json` in your root folder:
```json
[
  {
    "origin": ["*"],
    "method": ["GET"],
    "maxAgeSeconds": 3600
  }
]

```


2. Run this command (requires `gsutil` installed via Google Cloud SDK):
```bash
gsutil cors set cors.json gs://lstv-annotation-tool.firebasestorage.app

```



---

## 📊 How to Upload DICOM Files (Python Method)

We have created a custom Python script to handle uploads and Firestore metadata automatically.

### Prerequisites

1. Ensure your DICOMs are in `data/dicoms/`.
2. Ensure you have your `firebase-service-account.json` in `scripts/`.

### Command Syntax

Run this from your project root:

```bash
# General Syntax
python upload_dicoms.py <service_account_file> <dicom_directory> [--trial]

```

### ⚡ Trial Run (Uploads 3 Studies)

Use this to test the system without uploading everything:

```bash
python upload_dicoms.py scripts/firebase-service-account.json data/dicoms/ --trial

```

### 🚀 Full Upload

Use this to upload the entire dataset:

```bash
python upload_dicoms.py scripts/firebase-service-account.json data/dicoms/

```

---

## 🔑 Controls

| Key / Action | Function |
| --- | --- |
| **Arrow Up / Left** | Previous slice |
| **Arrow Down / Right** | Next slice |
| **Spacebar** | Play/pause cine loop |
| **Mouse Wheel** | Scroll through slices |
| **Click + Drag** | Adjust Window/Level (Brightness/Contrast) |

---

## 🐛 Troubleshooting

### Issue: "No DICOM files downloaded" or "404 Error"

**Cause:** The file path in Firestore does not match the file path in Storage.
**Fix:**

1. Check your Firestore `studies` collection. Look at the `files` array.
2. Example path expected: `dicoms/4003253/2448190387/1.dcm`.
3. Check Firebase Storage and ensure the file exists at exactly that path.

### Issue: Script says "Found 1 studies" when I have many

**Cause:** You likely pointed the script to `data/` instead of `data/dicoms/`.
**Fix:** Run the command with the deeper path: `data/dicoms/`.

### Issue: "Access to XMLHttpRequest blocked by CORS policy"

**Cause:** Firebase Storage security settings.
**Fix:** Run the `gsutil cors set` command listed in the Installation section above.

---

## 🎯 Pre-Abstract Checklist

* [ ] **CORS Fixed:** Ran `gsutil` command successfully.
* [ ] **Data Uploaded:** Ran `upload_dicoms.py` and saw "Success".
* [ ] **Auth Working:** Can log in via Google at `login.html`.
* [ ] **Viewer Working:** Can scroll through a study on `index.html`.

```

```
