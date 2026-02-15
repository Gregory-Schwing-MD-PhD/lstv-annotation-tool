// app_dual.js - Main application logic with proper file download handling
// Uses storageManager.downloadSeries() with progress callback

// =============================================================================
// GLOBAL STATE
// =============================================================================
let currentStudy = null;
let allStudies = [];

// =============================================================================
// INITIALIZATION - Runs when DOM is ready
// =============================================================================
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 Application initializing...');
    
    try {
        // Wait for authentication
        await waitForAuth();
        console.log('✓ User authenticated');

        // Load available studies from Firestore
        await loadAvailableStudies();
        console.log('✓ Studies loaded from Firestore');

        // Load first available study automatically
        await loadNextStudy();

        // Setup UI event listeners
        setupEventListeners();
        
        console.log('✓ Application ready');
    } catch (error) {
        console.error('❌ Initialization error:', error);
        showError('Failed to initialize application: ' + error.message);
    }
});

// =============================================================================
// AUTHENTICATION
// =============================================================================
function waitForAuth() {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Authentication timeout'));
        }, 10000);

        const unsubscribe = firebase.auth().onAuthStateChanged(user => {
            clearTimeout(timeout);
            unsubscribe();
            
            if (user) {
                document.getElementById('userName').textContent = user.email;
                resolve(user);
            } else {
                window.location.href = 'login.html';
                reject(new Error('No user authenticated'));
            }
        });
    });
}

// =============================================================================
// STUDY MANAGEMENT
// =============================================================================
async function loadAvailableStudies() {
    try {
        // Load studies that are "ready" status (matching your original logic)
        const snapshot = await firebase.firestore()
            .collection('studies')
            .where('status', '==', 'ready')
            .get();

        allStudies = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        updateDashboardStats();
        console.log(`Loaded ${allStudies.length} ready studies`);
    } catch (error) {
        console.error('Error loading studies:', error);
        throw error;
    }
}

function updateDashboardStats() {
    const user = firebase.auth().currentUser;
    if (!user) return;

    // Count user's completed annotations
    firebase.firestore()
        .collection('annotations')
        .where('userId', '==', user.uid)
        .get()
        .then(snapshot => {
            const yourReviews = snapshot.docs.length;
            document.getElementById('yourReviews').textContent = yourReviews;
        });

    // Total and available stats
    const total = allStudies.length;
    document.getElementById('totalStudies').textContent = total;
    document.getElementById('availableStudies').textContent = total;
    
    // Note: We'll update completed count after loading user progress
}

async function loadNextStudy() {
    const user = firebase.auth().currentUser;
    if (!user) return;

    // Get user's progress to filter out completed/skipped studies
    const progressDoc = await firebase.firestore()
        .collection('user_progress')
        .doc(user.uid)
        .get();
    
    const userProgress = progressDoc.exists ? progressDoc.data() : { annotations: {}, skippedStudies: [] };

    // Find first study not yet annotated or skipped by this user
    const nextStudy = allStudies.find(s => 
        !userProgress.annotations?.[s.study_id] && 
        !userProgress.skippedStudies?.includes(s.study_id)
    );
    
    if (!nextStudy) {
        showMessage('All studies have been annotated! 🎉');
        return;
    }

    await loadStudy(nextStudy, userProgress);
}

// =============================================================================
// CRITICAL: STUDY LOADING WITH PROPER DOWNLOAD SEQUENCE
// =============================================================================
async function loadStudy(study, userProgress) {
    console.log(`Loading study: ${study.study_id}`);
    currentStudy = study;

    // Update UI
    document.getElementById('currentStudyId').textContent = study.study_id;
    
    const loadingEl = document.getElementById('loadingMessage');
    const loadingStatus = document.getElementById('loadingStatus');
    
    loadingStatus.textContent = 'Preparing study...';
    loadingEl.style.display = 'flex';
    document.getElementById('dualViewContainer').style.display = 'none';

    try {
        // Find axial and sagittal series (matching your original logic)
        const axialSeries = study.series.find(s => 
            s.description.toLowerCase().includes('ax')
        );
        const sagittalSeries = study.series.find(s => 
            s.description.toLowerCase().includes('sag')
        );
        
        // Fallback to first series if not found
        const finalAxial = axialSeries || study.series[0];
        const finalSagittal = sagittalSeries || (study.series[1] || study.series[0]);

        if (!finalAxial || !finalSagittal) {
            throw new Error('Missing required series (axial or sagittal)');
        }

        // Download files with progress callbacks
        console.log('Downloading axial series...');
        const axialFiles = await fetchSeriesFiles(study.study_id, finalAxial, 'axial');
        
        console.log('Downloading sagittal series...');
        const sagittalFiles = await fetchSeriesFiles(study.study_id, finalSagittal, 'sagittal');

        console.log(`Downloaded ${axialFiles.length} axial + ${sagittalFiles.length} sagittal files`);

        // =========================================================================
        // CRITICAL SEQUENCE: Display container FIRST, then load images
        // =========================================================================
        
        loadingStatus.textContent = 'Loading images into viewer...';
        
        // STEP 1: Hide loading, show container with display:grid
        loadingEl.style.display = 'none';
        document.getElementById('dualViewContainer').style.display = 'grid';
        
        // STEP 2: Small delay to ensure layout renders
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // STEP 3: Load images into the now-visible viewer
        await dicomViewer.loadDualSeries(axialFiles, sagittalFiles);
        
        // STEP 4: Force resize to ensure proper dimensions
        if (typeof dicomViewer.resize === 'function') {
            dicomViewer.resize();
        }
        
        console.log('✓ Study loaded successfully');
        
        // Reset form
        document.getElementById('annotationForm').reset();
        
        // Update stats with user progress
        if (userProgress) {
            const completedCount = Object.keys(userProgress.annotations || {}).length;
            document.getElementById('completedStudies').textContent = completedCount;
        }
        
    } catch (error) {
        console.error('❌ Error loading study:', error);
        showError('Failed to load study: ' + error.message);
        
        // Revert to loading state
        document.getElementById('dualViewContainer').style.display = 'none';
        loadingEl.style.display = 'flex';
        loadingStatus.textContent = 'Error loading study. Please try again.';
    }
}

// =============================================================================
// FILE DOWNLOAD WITH PROGRESS (Using storageManager)
// =============================================================================
async function fetchSeriesFiles(studyId, series, seriesType) {
    // Determine filenames based on series data structure
    let filenames = [];
    
    if (series.files && Array.isArray(series.files)) {
        // If series has explicit file list
        filenames = series.files.map(f => f.filename);
    } else if (series.slice_count) {
        // If series has slice count, generate filenames
        filenames = Array.from(
            { length: series.slice_count }, 
            (_, i) => `${i + 1}.dcm`
        );
    } else {
        // Fallback: try common naming patterns
        console.warn(`No file list or slice_count for ${seriesType} series, using fallback`);
        filenames = Array.from({ length: 50 }, (_, i) => `${i + 1}.dcm`);
    }

    console.log(`Fetching ${filenames.length} files for ${seriesType} series...`);

    // Update progress callback
    const progressCallback = (current, total) => {
        const loadingStatus = document.getElementById('loadingStatus');
        if (loadingStatus) {
            const seriesName = series.description || seriesType;
            loadingStatus.textContent = `Downloading ${seriesName}: ${current}/${total}`;
        }
    };

    try {
        // Use storageManager to download files (this should be defined in storage.js)
        const files = await storageManager.downloadSeries(
            studyId, 
            series.series_id, 
            filenames, 
            progressCallback
        );

        console.log(`✓ Downloaded ${files.length} files for ${seriesType}`);
        return files;

    } catch (error) {
        console.error(`Error downloading ${seriesType} series:`, error);
        throw error;
    }
}

// =============================================================================
// ANNOTATION SUBMISSION
// =============================================================================
async function submitAnnotation() {
    if (!currentStudy) {
        showError('No study loaded');
        return;
    }

    const form = document.getElementById('annotationForm');
    const formData = new FormData(form);
    
    const castellviType = formData.get('castellvi_type');
    const confidence = formData.get('confidence');
    const notes = formData.get('notes') || '';

    if (!castellviType || !confidence) {
        showError('Please select both Type and Confidence');
        return;
    }

    console.log('Submitting annotation for study:', currentStudy.study_id);

    try {
        const user = firebase.auth().currentUser;
        
        // Get current slice positions
        const slices = dicomViewer.getCurrentSlices();
        
        const annotationData = {
            studyId: currentStudy.study_id,
            userId: user.uid,
            userEmail: user.email,
            castellvi_type: castellviType,
            confidence: confidence,
            notes: notes,
            slices: slices,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        };

        // Save annotation
        await firebase.firestore()
            .collection('annotations')
            .add(annotationData);

        // Update user progress
        const progressRef = firebase.firestore()
            .collection('user_progress')
            .doc(user.uid);
        
        const progressDoc = await progressRef.get();
        const currentProgress = progressDoc.exists ? progressDoc.data() : { annotations: {}, skippedStudies: [] };
        
        if (!currentProgress.annotations) {
            currentProgress.annotations = {};
        }
        currentProgress.annotations[currentStudy.study_id] = true;
        
        await progressRef.set(currentProgress, { merge: true });

        console.log('✓ Annotation submitted successfully');
        showMessage('Annotation saved! Loading next study...', 'success');

        // Update stats
        updateDashboardStats();
        
        // Load next study
        setTimeout(async () => {
            await loadNextStudy();
        }, 1500);

    } catch (error) {
        console.error('❌ Error submitting annotation:', error);
        showError('Failed to submit annotation: ' + error.message);
    }
}

async function skipStudy() {
    if (!currentStudy) return;

    console.log('Skipping study:', currentStudy.study_id);

    try {
        const user = firebase.auth().currentUser;
        
        // Update user progress to mark as skipped
        const progressRef = firebase.firestore()
            .collection('user_progress')
            .doc(user.uid);
        
        const progressDoc = await progressRef.get();
        const currentProgress = progressDoc.exists ? progressDoc.data() : { annotations: {}, skippedStudies: [] };
        
        if (!currentProgress.skippedStudies) {
            currentProgress.skippedStudies = [];
        }
        currentProgress.skippedStudies.push(currentStudy.study_id);
        
        await progressRef.set(currentProgress, { merge: true });

        showMessage('Study skipped. Loading next...', 'info');
        
        setTimeout(async () => {
            await loadNextStudy();
        }, 1000);

    } catch (error) {
        console.error('Error skipping study:', error);
        showError('Failed to skip study: ' + error.message);
    }
}

// =============================================================================
// UI EVENT LISTENERS
// =============================================================================
function setupEventListeners() {
    // Annotation form submission
    document.getElementById('annotationForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await submitAnnotation();
    });

    // Skip button
    document.getElementById('skipStudy').addEventListener('click', async () => {
        if (confirm('Skip this study? It will be marked for later review.')) {
            await skipStudy();
        }
    });

    // Reset windowing button
    document.getElementById('resetWindowing').addEventListener('click', () => {
        if (dicomViewer) {
            dicomViewer.resetWindowLevel();
        }
    });

    // Sign out button
    document.getElementById('signOutBtn').addEventListener('click', async () => {
        try {
            await firebase.auth().signOut();
            window.location.href = 'login.html';
        } catch (error) {
            console.error('Sign out error:', error);
        }
    });

    console.log('✓ Event listeners configured');
}

// =============================================================================
// UI HELPERS
// =============================================================================
function showMessage(message, type = 'info') {
    // Create a simple toast notification
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 16px 24px;
        background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
        color: white;
        border-radius: 8px;
        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        z-index: 10000;
        animation: slideIn 0.3s ease;
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function showError(message) {
    showMessage(message, 'error');
}

// =============================================================================
// ERROR BOUNDARY
// =============================================================================
window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
});

console.log('✓ app_dual.js loaded successfully');
