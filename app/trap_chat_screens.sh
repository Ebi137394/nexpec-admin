#!/bin/bash
echo "🚨 DEPLOYING GLOBAL CHAT TRAP"

# Trap 1: app/chat/[job_id].tsx
echo "✅ Trapping app/chat/[job_id].tsx"
sed -i '' 's/router.replace/\/\/ 🚨 TRAP DISABLED router.replace/g' app/chat/[job_id].tsx
sed -i '' 's/router.back/\/\/ 🚨 TRAP DISABLED router.back/g' app/chat/[job_id].tsx
sed -i '' '/<SafeAreaView/a\
    <View style={{ backgroundColor: "red", padding: 20, margin: 10, borderRadius: 10, zIndex: 999 }}><Text style={{ color: "white", fontWeight: "bold", fontSize: 16 }}>🚨 TRAP TRIGGERED IN:<\/Text><Text style={{ color: "white", fontSize: 14 }}>app/chat/[job_id].tsx<\/Text><\/View>' app/chat/[job_id].tsx

# Trap 2: app/messages/[id].tsx
echo "✅ Trapping app/messages/[id].tsx"
sed -i '' 's/router.replace/\/\/ 🚨 TRAP DISABLED router.replace/g' app/messages/[id].tsx 2>/dev/null
sed -i '' 's/router.back/\/\/ 🚨 TRAP DISABLED router.back/g' app/messages/[id].tsx 2>/dev/null
sed -i '' '/<SafeAreaView/a\
    <View style={{ backgroundColor: "red", padding: 20, margin: 10, borderRadius: 10, zIndex: 999 }}><Text style={{ color: "white", fontWeight: "bold", fontSize: 16 }}>🚨 TRAP TRIGGERED IN:<\/Text><Text style={{ color: "white", fontSize: 14 }}>app/messages/[id].tsx<\/Text><\/View>' app/messages/[id].tsx 2>/dev/null

# Trap 3: app/messages/[jobId].tsx
echo "✅ Trapping app/messages/[jobId].tsx"
sed -i '' 's/router.replace/\/\/ 🚨 TRAP DISABLED router.replace/g' app/messages/[jobId].tsx 2>/dev/null
sed -i '' 's/router.back/\/\/ 🚨 TRAP DISABLED router.back/g' app/messages/[jobId].tsx 2>/dev/null
sed -i '' '/<SafeAreaView/a\
    <View style={{ backgroundColor: "red", padding: 20, margin: 10, borderRadius: 10, zIndex: 999 }}><Text style={{ color: "white", fontWeight: "bold", fontSize: 16 }}>🚨 TRAP TRIGGERED IN:<\/Text><Text style={{ color: "white", fontSize: 14 }}>app/messages/[jobId].tsx<\/Text><\/View>' app/messages/[jobId].tsx 2>/dev/null

echo "✅ ALL CHAT SCREENS TRAPPED. Run the app now. The red banner will reveal exactly which file is being rendered."