// Annotations Manager
class AnnotationsManager {
    constructor() {
        this.db = firebase.firestore();
        this.currentStudy = null;
    }

    // Submit annotation to Firestore
    async submitAnnotation(studyId, seriesId, annotationData) {
        try {
            const user = authManager.getUser();
            
            if (!user) {
                throw new Error('User not authenticated');
            }

            // Create annotation document
            const annotation = {
                study_id: studyId,
                series_id: seriesId,
                castellvi_type: annotationData.castellvi_type,
                confidence: annotationData.confidence,
                notes: annotationData.notes || '',
                user_id: user.uid,
                user_email: user.email,
                user_name: user.displayName || user.email,
                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                current_slice: annotationData.current_slice || 0,
                total_slices: annotationData.total_slices || 0
            };

            // Add to Firestore
            const docRef = await this.db.collection('annotations').add(annotation);
            
            console.log('Annotation submitted:', docRef.id);
            
            // Update user progress
            await this.updateUserProgress(user.uid, studyId);
            
            return docRef.id;
        } catch (error) {
            console.error('Error submitting annotation:', error);
            throw error;
        }
    }

    // Update user progress tracker
    async updateUserProgress(userId, studyId) {
        try {
            const progressRef = this.db.collection('user_progress').doc(userId);
            
            await progressRef.set({
                last_updated: firebase.firestore.FieldValue.serverTimestamp(),
                reviewed_studies: firebase.firestore.FieldValue.arrayUnion(studyId)
            }, { merge: true });
            
        } catch (error) {
            console.error('Error updating user progress:', error);
        }
    }

    // Get user's reviewed studies
    async getUserReviewedStudies(userId) {
        try {
            const progressDoc = await this.db.collection('user_progress').doc(userId).get();
            
            if (progressDoc.exists) {
                const data = progressDoc.data();
                return data.reviewed_studies || [];
            }
            
            return [];
        } catch (error) {
            console.error('Error getting user progress:', error);
            return [];
        }
    }

    // Get all annotations for a study
    async getStudyAnnotations(studyId) {
        try {
            const snapshot = await this.db.collection('annotations')
                .where('study_id', '==', studyId)
                .get();
            
            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        } catch (error) {
            console.error('Error getting study annotations:', error);
            return [];
        }
    }

    // Get user's annotation count
    async getUserAnnotationCount(userId) {
        try {
            const snapshot = await this.db.collection('annotations')
                .where('user_id', '==', userId)
                .get();
            
            return snapshot.size;
        } catch (error) {
            console.error('Error getting annotation count:', error);
            return 0;
        }
    }

    // Get completed studies (studies with 3+ annotations)
    async getCompletedStudiesCount() {
        try {
            // Get all annotations
            const snapshot = await this.db.collection('annotations').get();
            
            // Group by study_id
            const studyCounts = new Map();
            snapshot.docs.forEach(doc => {
                const studyId = doc.data().study_id;
                studyCounts.set(studyId, (studyCounts.get(studyId) || 0) + 1);
            });
            
            // Count studies with 3+ annotations
            let completedCount = 0;
            studyCounts.forEach((count) => {
                if (count >= 3) completedCount++;
            });
            
            return completedCount;
        } catch (error) {
            console.error('Error getting completed studies:', error);
            return 0;
        }
    }

    // Get annotation statistics
    async getAnnotationStats() {
        try {
            const userId = authManager.getUserId();
            
            // Get all studies
            const studiesSnapshot = await this.db.collection('studies').get();
            const totalStudies = studiesSnapshot.size;
            
            // Get user's annotation count
            const userAnnotations = await this.getUserAnnotationCount(userId);
            
            // Get completed studies count
            const completedStudies = await this.getCompletedStudiesCount();
            
            // Get user's reviewed studies
            const reviewedStudies = await this.getUserReviewedStudies(userId);
            const availableStudies = totalStudies - reviewedStudies.length;
            
            return {
                yourReviews: userAnnotations,
                completedStudies: completedStudies,
                availableStudies: Math.max(0, availableStudies),
                totalStudies: totalStudies
            };
        } catch (error) {
            console.error('Error getting annotation stats:', error);
            return {
                yourReviews: 0,
                completedStudies: 0,
                availableStudies: 0,
                totalStudies: 0
            };
        }
    }
}

// Create global annotations manager instance
const annotationsManager = new AnnotationsManager();
