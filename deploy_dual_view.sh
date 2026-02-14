#!/bin/bash

# ==============================================================================
# 🚀 LSTV Dual-View ACTIVATOR
# Use this when JS files are already in static/js/
# ==============================================================================

echo "🚀 Activating Dual-View Mode..."
echo "=================================="

# 1. VERIFY ASSETS EXIST (Don't move them, just check them)
if [ -f "static/js/viewer_dual.js" ] && [ -f "static/js/app_dual.js" ]; then
    echo "✅ Verified: Dual-view JS files are present in static/js/"
else
    echo "❌ Error: viewer_dual.js or app_dual.js are missing from static/js/"
    echo "   Please make sure those files exist before running this."
    exit 1
fi

# 2. BACKUP EXISTING INDEX (Single View)
if [ -f "index.html" ]; then
    # Check if we already have a backup so we don't overwrite it with a dual-view version later
    if [ ! -f "index_single.html" ]; then
        echo "📦 Backing up current index.html -> index_single.html"
        cp index.html index_single.html
    else
        echo "ℹ️  Backup (index_single.html) already exists. Keeping it safe."
    fi
fi

# 3. SWAP THE HTML FILE
if [ -f "index_dual.html" ]; then
    echo "🔄 Activating Dual View: Overwriting index.html with index_dual.html"
    cp index_dual.html index.html
else
    echo "❌ Error: index_dual.html not found in root directory!"
    exit 1
fi

echo "=================================="
echo "🎉 SUCCESS! Dual view is live locally."
echo ""
echo "👉 NEXT STEP: Run these commands to push to GitHub:"
echo "   git add ."
echo "   git commit -m 'feat: switch to dual view'"
echo "   git push"
