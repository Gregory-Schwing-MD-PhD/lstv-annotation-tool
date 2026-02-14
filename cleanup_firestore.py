#!/usr/bin/env python3
"""
Clean up broken studies from Firestore that don't have files in Storage.
"""

import sys
import firebase_admin
from firebase_admin import credentials, firestore

def main():
    if len(sys.argv) < 2:
        print("Usage: python cleanup_firestore.py <service_account.json>")
        sys.exit(1)
    
    service_account_path = sys.argv[1]
    
    # Initialize Firebase
    cred = credentials.Certificate(service_account_path)
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    
    print("🔍 Checking Firestore studies...\n")
    
    # Get all studies
    studies_ref = db.collection('studies')
    studies = studies_ref.stream()
    
    for study_doc in studies:
        study_data = study_doc.to_dict()
        study_id = study_data.get('study_id')
        
        print(f"Study: {study_id}")
        print(f"  Series: {len(study_data.get('series', []))}")
        print(f"  Total slices: {study_data.get('total_slices', 0)}")
        
        # Ask if user wants to delete
        response = input(f"  Delete this study? (yes/no): ")
        if response.lower() == 'yes':
            studies_ref.document(study_doc.id).delete()
            print(f"  ✅ Deleted study {study_id}\n")
        else:
            print(f"  ⏭️  Skipped\n")
    
    print("\n✅ Cleanup complete!")

if __name__ == '__main__':
    main()
