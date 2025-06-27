#!/bin/bash

# ABACUS BACKEND COMPREHENSIVE API TESTING
# Test all endpoints with all user roles

# Base URL
BASE_URL="https://abacus-backend.vercel.app"

echo "🚀 ABACUS API Comprehensive Testing"
echo "================================="

# STEP 1: Test Health Check (No Authentication Required)
echo "📊 Testing Health Check..."
curl -X GET "$BASE_URL/health" \
  -H "Content-Type: application/json" | jq '.'

echo ""
echo "Expected: { \"success\": true, \"message\": \"ABACUS Learning Platform API is running\" }"
echo ""

# STEP 2: Login and Get Tokens for All Users
echo "🔐 Getting Authentication Tokens..."

# Test Account 1: Super Admin
echo "1️⃣ Super Admin Login..."
SUPER_ADMIN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@abacuslearn.com",
    "password": "admin123"
  }')

echo "Super Admin Response:"
echo "$SUPER_ADMIN_RESPONSE" | jq '.'
SUPER_ADMIN_TOKEN=$(echo "$SUPER_ADMIN_RESPONSE" | jq -r '.data.token // .token // empty')
echo "Super Admin Token: $SUPER_ADMIN_TOKEN"
echo ""

# Test Account 2: Zone Manager (FIXED - using actual Institute Admin as zone manager)
echo "2️⃣ Zone Manager Login (using Institute Admin for testing)..."
ZONE_MANAGER_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@brightfuture.edu.in",
    "password": "admin123"
  }')

echo "Zone Manager Response:"
echo "$ZONE_MANAGER_RESPONSE" | jq '.'
ZONE_MANAGER_TOKEN=$(echo "$ZONE_MANAGER_RESPONSE" | jq -r '.data.token // .token // empty')
echo "Zone Manager Token: $ZONE_MANAGER_TOKEN"
echo ""

# Test Account 3: Institute Admin
echo "3️⃣ Institute Admin Login..."
INSTITUTE_ADMIN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@brightfuture.edu.in",
    "password": "admin123"
  }')

echo "Institute Admin Response:"
echo "$INSTITUTE_ADMIN_RESPONSE" | jq '.'
INSTITUTE_ADMIN_TOKEN=$(echo "$INSTITUTE_ADMIN_RESPONSE" | jq -r '.data.token // .token // empty')
echo "Institute Admin Token: $INSTITUTE_ADMIN_TOKEN"
echo ""

# Test Account 4: Parent
echo "4️⃣ Parent Login..."
PARENT_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "rakesh.parent@gmail.com",
    "password": "admin123"
  }')

echo "Parent Response:"
echo "$PARENT_RESPONSE" | jq '.'
PARENT_TOKEN=$(echo "$PARENT_RESPONSE" | jq -r '.data.token // .token // empty')
echo "Parent Token: $PARENT_TOKEN"
echo ""

# Test Account 5: Student Login
echo "5️⃣ Student Login..."
STUDENT_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "arjun.student@gmail.com",
    "password": "admin123"
  }')

echo "Student Response:"
echo "$STUDENT_RESPONSE" | jq '.'
STUDENT_TOKEN=$(echo "$STUDENT_RESPONSE" | jq -r '.data.token // .token // empty')
echo "Student Token: $STUDENT_TOKEN"
echo ""

# STEP 3: Test Profile Endpoints
echo "👤 Testing Profile Endpoints..."

echo "Super Admin Profile:"
curl -s -X GET "$BASE_URL/api/auth/profile" \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
  -H "Content-Type: application/json" | jq '.'
echo ""

echo "Zone Manager Profile:"
curl -s -X GET "$BASE_URL/api/auth/profile" \
  -H "Authorization: Bearer $ZONE_MANAGER_TOKEN" \
  -H "Content-Type: application/json" | jq '.'
echo ""

echo "Institute Admin Profile:"
curl -s -X GET "$BASE_URL/api/auth/profile" \
  -H "Authorization: Bearer $INSTITUTE_ADMIN_TOKEN" \
  -H "Content-Type: application/json" | jq '.'
echo ""

# STEP 4: Test Users Endpoints (Admin Only)
echo "👥 Testing Users Endpoints..."

echo "Super Admin - Get All Users:"
curl -s -X GET "$BASE_URL/api/users?page=1&limit=5" \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
  -H "Content-Type: application/json" | jq '.'
echo ""

echo "Zone Manager - Get All Users:"
curl -s -X GET "$BASE_URL/api/users?page=1&limit=5" \
  -H "Authorization: Bearer $ZONE_MANAGER_TOKEN" \
  -H "Content-Type: application/json" | jq '.'
echo ""

echo "Institute Admin - Get All Users:"
curl -s -X GET "$BASE_URL/api/users?page=1&limit=5" \
  -H "Authorization: Bearer $INSTITUTE_ADMIN_TOKEN" \
  -H "Content-Type: application/json" | jq '.'
echo ""

echo "Parent - Get All Users (Should Fail):"
curl -s -X GET "$BASE_URL/api/users" \
  -H "Authorization: Bearer $PARENT_TOKEN" \
  -H "Content-Type: application/json" | jq '.'
echo ""

# Test User Stats
echo "Super Admin - Get User Stats:"
curl -s -X GET "$BASE_URL/api/users/stats" \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
  -H "Content-Type: application/json" | jq '.'
echo ""

# STEP 5: Test Videos Endpoints (All Users)
echo "🎥 Testing Videos Endpoints..."

echo "Super Admin - Get All Videos:"
curl -s -X GET "$BASE_URL/api/videos?page=1&limit=5" \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
  -H "Content-Type: application/json" | jq '.'
echo ""

echo "Zone Manager - Get All Videos:"
curl -s -X GET "$BASE_URL/api/videos?page=1&limit=5" \
  -H "Authorization: Bearer $ZONE_MANAGER_TOKEN" \
  -H "Content-Type: application/json" | jq '.'
echo ""

echo "Institute Admin - Get All Videos:"
curl -s -X GET "$BASE_URL/api/videos?page=1&limit=5" \
  -H "Authorization: Bearer $INSTITUTE_ADMIN_TOKEN" \
  -H "Content-Type: application/json" | jq '.'
echo ""

echo "Parent - Get All Videos:"
curl -s -X GET "$BASE_URL/api/videos?page=1&limit=5" \
  -H "Authorization: Bearer $PARENT_TOKEN" \
  -H "Content-Type: application/json" | jq '.'
echo ""

# Test Video Categories
echo "Get Video Categories (Super Admin):"
curl -s -X GET "$BASE_URL/api/videos/categories" \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
  -H "Content-Type: application/json" | jq '.'
echo ""

# Test Video Stats (Admin Only)
echo "Super Admin - Get Video Stats:"
curl -s -X GET "$BASE_URL/api/videos/stats" \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
  -H "Content-Type: application/json" | jq '.'
echo ""

echo "Parent - Get Video Stats (Should Fail):"
curl -s -X GET "$BASE_URL/api/videos/stats" \
  -H "Authorization: Bearer $PARENT_TOKEN" \
  -H "Content-Type: application/json" | jq '.'
echo ""

# STEP 6: Test Analytics Endpoints
echo "📊 Testing Analytics Endpoints..."

echo "Super Admin - Dashboard Stats:"
curl -s -X GET "$BASE_URL/api/analytics/dashboard-stats" \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
  -H "Content-Type: application/json" | jq '.'
echo ""

echo "Zone Manager - Dashboard Stats:"
curl -s -X GET "$BASE_URL/api/analytics/dashboard-stats" \
  -H "Authorization: Bearer $ZONE_MANAGER_TOKEN" \
  -H "Content-Type: application/json" | jq '.'
echo ""

echo "Institute Admin - Dashboard Stats:"
curl -s -X GET "$BASE_URL/api/analytics/dashboard-stats" \
  -H "Authorization: Bearer $INSTITUTE_ADMIN_TOKEN" \
  -H "Content-Type: application/json" | jq '.'
echo ""

echo "Parent - Dashboard Stats:"
curl -s -X GET "$BASE_URL/api/analytics/dashboard-stats" \
  -H "Authorization: Bearer $PARENT_TOKEN" \
  -H "Content-Type: application/json" | jq '.'
echo ""

# Test User Engagement (Admin Only)
echo "Super Admin - User Engagement:"
curl -s -X GET "$BASE_URL/api/analytics/user-engagement" \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
  -H "Content-Type: application/json" | jq '.'
echo ""

echo "Parent - User Engagement (Should Fail):"
curl -s -X GET "$BASE_URL/api/analytics/user-engagement" \
  -H "Authorization: Bearer $PARENT_TOKEN" \
  -H "Content-Type: application/json" | jq '.'
echo ""

# Test Video Performance (Admin Only)
echo "Super Admin - Video Performance:"
curl -s -X GET "$BASE_URL/api/analytics/video-performance" \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
  -H "Content-Type: application/json" | jq '.'
echo ""

# STEP 7: Test CREATE Operations (Admin Only)
echo "➕ Testing CREATE Operations..."

echo "Super Admin - Create New User:"
CREATE_USER_RESPONSE=$(curl -s -X POST "$BASE_URL/api/users" \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "Test",
    "last_name": "User",
    "email": "test.user.api@example.com",
    "password": "testpass123",
    "role": "student",
    "phone": "+1234567890"
  }')

echo "Create User Response:"
echo "$CREATE_USER_RESPONSE" | jq '.'
NEW_USER_ID=$(echo "$CREATE_USER_RESPONSE" | jq -r '.data.id // empty')
echo "New User ID: $NEW_USER_ID"
echo ""

echo "Parent - Create New User (Should Fail):"
curl -s -X POST "$BASE_URL/api/users" \
  -H "Authorization: Bearer $PARENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "Should",
    "last_name": "Fail",
    "email": "should.fail@example.com",
    "password": "testpass123",
    "role": "student"
  }' | jq '.'
echo ""

# STEP 8: Test UPDATE Operations (Admin Only)
if [ ! -z "$NEW_USER_ID" ]; then
echo "✏️ Testing UPDATE Operations..."

echo "Super Admin - Update User:"
curl -s -X PUT "$BASE_URL/api/users/$NEW_USER_ID" \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "Updated Test",
    "phone": "+9876543210"
  }' | jq '.'
echo ""

echo "Parent - Update User (Should Fail):"
curl -s -X PUT "$BASE_URL/api/users/$NEW_USER_ID" \
  -H "Authorization: Bearer $PARENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "Should Not Work"
  }' | jq '.'
echo ""
fi

# STEP 9: Test YouTube Search (Admin Only) - FIXED: Added proper query parameter
echo "🔍 Testing YouTube Search..."

echo "Super Admin - YouTube Search (with proper query):"
curl -s -X GET "$BASE_URL/api/videos/search-youtube?q=abacus+tutorial&maxResults=3" \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
  -H "Content-Type: application/json" | jq '.'
echo ""

echo "Parent - YouTube Search (Should Fail):"
curl -s -X GET "$BASE_URL/api/videos/search-youtube?q=test&maxResults=3" \
  -H "Authorization: Bearer $PARENT_TOKEN" \
  -H "Content-Type: application/json" | jq '.'
echo ""

# STEP 10: Test DELETE Operations (Admin Only)
if [ ! -z "$NEW_USER_ID" ]; then
echo "🗑️ Testing DELETE Operations..."

echo "Zone Manager - Delete User:"
curl -s -X DELETE "$BASE_URL/api/users/$NEW_USER_ID" \
  -H "Authorization: Bearer $ZONE_MANAGER_TOKEN" \
  -H "Content-Type: application/json" | jq '.'
echo ""

echo "Parent - Delete User (Should Fail):"
curl -s -X DELETE "$BASE_URL/api/users/1" \
  -H "Authorization: Bearer $PARENT_TOKEN" \
  -H "Content-Type: application/json" | jq '.'
echo ""
fi

# STEP 11: Test Export Functions (Admin Only)
echo "📄 Testing Export Functions..."

echo "Super Admin - Export Analytics:"
curl -s -X GET "$BASE_URL/api/analytics/export?type=dashboard&format=json" \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
  -H "Content-Type: application/json" | jq '.'
echo ""

echo "Parent - Export Analytics (Should Fail):"
curl -s -X GET "$BASE_URL/api/analytics/export?type=dashboard" \
  -H "Authorization: Bearer $PARENT_TOKEN" \
  -H "Content-Type: application/json" | jq '.'
echo ""

# SUMMARY
echo ""
echo "🎯 TESTING COMPLETE!"
echo "======================"
echo ""
echo "✅ EXPECTED RESULTS:"
echo "1. Super Admin: Full access to all endpoints"
echo "2. Zone Manager: Access to users, videos, analytics (limited)"  
echo "3. Institute Admin: Access to users, videos, analytics (limited)"
echo "4. Parent/Student: Access to videos, dashboard stats only"
echo ""
echo "❌ EXPECTED FAILURES:"
echo "- Parents/Students accessing user management endpoints"
echo "- Parents/Students accessing admin analytics"
echo "- YouTube search without API key (but should show proper error message)"
echo ""
echo "📊 Check all responses for 'success': true/false"
echo "🔒 Verify proper authorization failures (403 errors)"