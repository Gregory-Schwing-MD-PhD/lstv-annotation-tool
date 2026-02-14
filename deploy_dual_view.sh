#!/bin/bash
# Deploy Dual-View (Preserving Single-View)

echo "🚀 LSTV Annotation Tool - Dual-View Deployment"
echo "================================================"
echo ""

# Check if we're in the right directory
if [ ! -f "index.html" ]; then
    echo "❌ Error: index.html not found. Please run this script from your repo root."
    exit 1
fi

echo "📦 Step 1: Backing up current single-view..."
if [ -f "index_single.html" ]; then
    echo "⚠️  index_single.html already exists. Skipping backup."
else
    cp index.html index_single.html
    echo "✅ Created index_single.html (backup)"
fi

echo ""
echo "📦 Step 2: Deploying dual-view files..."

# Copy dual-view files to correct locations
if [ -f "index_dual.html" ]; then
    cp index_dual.html index.html
    echo "✅ index.html (dual-view)"
else
    echo "❌ index_dual.html not found!"
    exit 1
fi

if [ -f "viewer_dual.js" ]; then
    cp viewer_dual.js static/js/viewer_dual.js
    echo "✅ static/js/viewer_dual.js"
else
    echo "❌ viewer_dual.js not found!"
    exit 1
fi

if [ -f "app_dual.js" ]; then
    cp app_dual.js static/js/app_dual.js
    echo "✅ static/js/app_dual.js"
else
    echo "❌ app_dual.js not found!"
    exit 1
fi

if [ -f "viewer.js" ]; then
    cp viewer.js static/js/viewer.js
    echo "✅ static/js/viewer.js (single-view backup)"
else
    echo "⚠️  viewer.js not found. Single-view may not work."
fi

if [ -f "style.css" ]; then
    cp style.css static/css/style.css
    echo "✅ static/css/style.css (updated)"
else
    echo "❌ style.css not found!"
    exit 1
fi

echo ""
echo "📦 Step 3: Verifying file structure..."
echo ""
echo "Main files:"
ls -lh index.html index_single.html 2>/dev/null || echo "⚠️  Some files missing"

echo ""
echo "JavaScript files:"
ls -lh static/js/viewer*.js static/js/app*.js 2>/dev/null || echo "⚠️  Some JS files missing"

echo ""
echo "================================================"
echo "✅ Deployment complete!"
echo ""
echo "📝 Next steps:"
echo "  1. Test locally by opening index.html in your browser"
echo "  2. If everything works:"
echo "     git add ."
echo "     git commit -m 'feat: dual-view with crosshairs (single-view preserved)'"
echo "     git push origin main"
echo ""
echo "🔗 Access:"
echo "  Dual-view:   https://gregory-schwing-md-phd.github.io/lstv-annotation-tool/"
echo "  Single-view: https://gregory-schwing-md-phd.github.io/lstv-annotation-tool/index_single.html"
echo ""
