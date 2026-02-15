// app_dual.js - Main application logic with dual-view study loading
// CRITICAL: This file handles the display timing sequence to prevent white screens

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
        const snapshot = await firebase.firestore()
            .collection('studies')
            .orderBy('created_at', 'asc')
            .get();

        allStudies = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        updateDashboardStats();
        console.log(`Loaded ${allStudies.length} total studies`);
    } catch (error) {
        console.error('Error loading studies:', error);
        throw error;
    }
}

function updateDashboardStats() {
    const completed = allStudies.filter(s => s.annotation_status === 'completed').length;
    const available = allStudies.filter(s => s.annotation_status === 'pending').length;
    
    document.getElementById('completedStudies').textContent = completed;
    document.getElementById('availableStudies').textContent = available;
    document.getElementById('totalStudies').textContent = allStudies.length;
}

async function loadNextStudy() {
    // Find first pending study
    const nextStudy = allStudies.find(s => s.annotation_status === 'pending');
    
    if (!nextStudy) {
        showMessage('All studies have been annotated! 🎉');
        return;
    }

    await loadStudy(nextStudy);
}

// =============================================================================
// CRITICAL: STUDY LOADING WITH PROPER DISPLAY SEQUENCE
// =============================================================================
async function loadStudy(study) {
    console.log(`Loading study: ${study.id}`);
    currentStudy = study;

    // Update UI
    document.getElementById('currentStudyId').textContent = study.id;
    document.getElementById('loadingStatus').textContent = 'Loading DICOM files from Firebase Storage...';
    document.getElementById('loadingMessage').style.display = 'flex';
    document.getElementById('dualViewContainer').style.display = 'none';

    try {
        // Fetch file URLs from Firebase Storage
        const axialUrls = await fetchSeriesUrls(study.storage_path, 'axial');
        const sagittalUrls = await fetchSeriesUrls(study.storage_path, 'sagittal');

        console.log(`Fetched ${axialUrls.length} axial + ${sagittalUrls.length} sagittal URLs`);

        if (axialUrls.length === 0 || sagittalUrls.length === 0) {
            throw new Error('Missing series data in storage');
        }

        // =========================================================================
        // CRITICAL SEQUENCE: Display container FIRST, then load images
        // =========================================================================
        
        // STEP 1: Show the container with display:grid
        document.getElementById('loadingMessage').style.display = 'none';
        document.getElementById('dualViewContainer').style.display = 'grid';
        
        // STEP 2: Small delay to ensure layout renders and containers have dimensions
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // STEP 3: Verify containers have dimensions
        const axialRect = document.getElementById('axialViewer').getBoundingClientRect();
        const sagittalRect = document.getElementById('sagittalViewer').getBoundingClientRect();
        
        console.log('Verified dimensions - Axial:', axialRect.width, 'x', axialRect.height);
        console.log('Verified dimensions - Sagittal:', sagittalRect.width, 'x', sagittalRect.height);
        
        if (axialRect.width === 0 || axialRect.height === 0 || 
            sagittalRect.width === 0 || sagittalRect.height === 0) {
            throw new Error('Viewer containers still have no dimensions after display');
        }
        
        // STEP 4: NOW load the images (containers are visible and have dimensions)
        console.log('Loading images into visible containers...');
        await dicomViewer.loadDualSeries(axialUrls, sagittalUrls);
        
        console.log('✓ Study loaded successfully');
        
        // Reset form
        document.getElementById('annotationForm').reset();
        
    } catch (error) {
        console.error('❌ Error loading study:', error);
        showError('Failed to load study: ' + error.message);
        
        // Revert to loading state
        document.getElementById('dualViewContainer').style.display = 'none';
        document.getElementById('loadingMessage').style.display = 'flex';
    }
}

// =============================================================================
// FIREBASE STORAGE HELPERS
// =============================================================================
async function fetchSeriesUrls(storagePath, seriesName) {
    try {
        const storageRef = firebase.storage().ref();
        const seriesPath = `${storagePath}/${seriesName}`;
        const seriesRef = storageRef.child(seriesPath);
        
        console.log(`Fetching files from: ${seriesPath}`);
        
        const result = await seriesRef.listAll();
        
        if (result.items.length === 0) {
            console.warn(`No files found in ${seriesPath}`);
            return [];
        }

        // Get download URLs for all files
        const urlPromises = result.items.map(item => item.getDownloadURL());
        const urls = await Promise.all(urlPromises);
        
        // Sort URLs by filename (assumes numeric naming like 001.dcm, 002.dcm)
        urls.sort((a, b) => {
            const fileA = a.split('/').pop().split('?')[0];
            const fileB = b.split('/').pop().split('?')[0];
            return fileA.localeCompare(fileB, undefined, { numeric: true });
        });
        
        console.log(`✓ Fetched ${urls.length} files from ${seriesName}`);
        return urls;
        
    } catch (error) {
        console.error(`Error fetching ${seriesName} series:`, error);
        throw error;
    }
}

// =============================================================================
// ANNOTATION SUBMISSION
// =============================================================================
async function submitAnnotation(formData) {
    if (!currentStudy) {
        showError('No study loaded');
        return;
    }

    console.log('Submitting annotation for study:', currentStudy.id);

    try {
        const user = firebase.auth().currentUser;
        
        const annotationData = {
            study_id: currentStudy.id,
            annotator_id: user.uid,
            annotator_email: user.email,
            castellvi_type: formData.castellvi_type,
            confidence: formData.confidence,
            notes: formData.notes || '',
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            axial_slice: dicomViewer.currentAxialIndex,
            sagittal_slice: dicomViewer.currentSagittalIndex
        };

        // Save to Firestore
        await firebase.firestore()
            .collection('annotations')
            .add(annotationData);

        // Update study status
        await firebase.firestore()
            .collection('studies')
            .doc(currentStudy.id)
            .update({
                annotation_status: 'completed',
                completed_at: firebase.firestore.FieldValue.serverTimestamp()
            });

        console.log('✓ Annotation submitted successfully');
        showMessage('Annotation saved! Loading next study...', 'success');

        // Reload studies and load next one
        await loadAvailableStudies();
        
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

    console.log('Skipping study:', currentStudy.id);

    try {
        // Mark as skipped
        await firebase.firestore()
            .collection('studies')
            .doc(currentStudy.id)
            .update({
                annotation_status: 'skipped',
                skipped_at: firebase.firestore.FieldValue.serverTimestamp(),
                skipped_by: firebase.auth().currentUser.uid
            });

        showMessage('Study skipped. Loading next...', 'info');
        
        await loadAvailableStudies();
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
        
        const formData = {
            castellvi_type: document.querySelector('input[name="castellvi_type"]:checked')?.value,
            confidence: document.querySelector('input[name="confidence"]:checked')?.value,
            notes: document.getElementById('notes').value
        };

        if (!formData.castellvi_type || !formData.confidence) {
            showError('Please select both Type and Confidence');
            return;
        }

        await submitAnnotation(formData);
    });

    // Skip button
    document.getElementById('skipStudy').addEventListener('click', async () => {
        if (confirm('Skip this study? It will be marked for later review.')) {
            await skipStudy();
        }
    });

    // Reset windowing button
    document.getElementById('resetWindowing').addEventListener('click', () => {
        dicomViewer.resetWindowing();
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
    showError('An unexpected error occurred. Check console for details.');
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    showError('An unexpected error occurred. Check console for details.');
});

console.log('✓ app_dual.js loaded successfully');
