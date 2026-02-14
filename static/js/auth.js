// Authentication Module
class AuthManager {
    constructor() {
        this.currentUser = null;
        this.onAuthChangedCallbacks = [];
        this.initialized = false;
    }
    
    // Initialize auth state listener
    init() {
        return new Promise((resolve, reject) => {
            const unsubscribe = auth.onAuthStateChanged((user) => {
                if (user) {
                    this.currentUser = user;
                    this.updateUI(user);
                    this.initialized = true;
                    this.onAuthChangedCallbacks.forEach(callback => callback(user));
                    console.log('User authenticated:', user.email);
                    resolve(user);
                } else {
                    // Not signed in, redirect to login
                    console.log('No user authenticated, redirecting to login...');
                    const currentPath = window.location.pathname;
                    if (!currentPath.includes('login.html')) {
                        window.location.href = 'login.html';
                    }
                    reject(new Error('Not authenticated'));
                }
                unsubscribe(); // Only check once during init
            });
        });
    }
    
    // Register callback for auth state changes
    onAuthChanged(callback) {
        this.onAuthChangedCallbacks.push(callback);
    }
    
    // Update UI with user info
    updateUI(user) {
        const userNameElement = document.getElementById('userName');
        if (userNameElement) {
            userNameElement.textContent = user.displayName || user.email;
        }
    }
    
    // Sign out
    async signOut() {
        try {
            await auth.signOut();
            window.location.href = 'login.html';
        } catch (error) {
            console.error('Sign out error:', error);
            alert('Error signing out. Please try again.');
        }
    }
    
    // Get current user
    getUser() {
        return this.currentUser;
    }
    
    // Get user ID
    getUserId() {
        return this.currentUser ? this.currentUser.uid : null;
    }
    
    // Get user email
    getUserEmail() {
        return this.currentUser ? this.currentUser.email : null;
    }
    
    // Get user name
    getUserName() {
        return this.currentUser ? (this.currentUser.displayName || this.currentUser.email) : null;
    }
}

// Create global auth manager instance
const authManager = new AuthManager();
