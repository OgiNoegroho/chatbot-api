require("dotenv").config();
const fs = require("fs");
const path = require("path");

console.log("=== CHECKING FUNCTION USAGE IN SERVICES ===\n");

// Function to read file content
function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    console.log(`❌ Could not read ${filePath}: ${error.message}`);
    return null;
  }
}

// Function to extract function/method names from a class
function extractClassMethods(content, className) {
  const methods = [];
  
  // Match public methods (async and non-async)
  const methodRegex = /(?:public\s+)?(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*{/g;
  let match;
  
  while ((match = methodRegex.exec(content)) !== null) {
    const methodName = match[1];
    // Skip constructor and common keywords
    if (methodName !== 'constructor' && methodName !== 'if' && methodName !== 'for' && methodName !== 'while') {
      methods.push(methodName);
    }
  }
  
  return methods;
}

// Function to check if a method is used in a file
function isMethodUsed(content, methodName, serviceName) {
  // Check for direct method calls like chatService.methodName
  const directCallRegex = new RegExp(`${serviceName}\\.${methodName}\\s*\\(`, 'g');
  // Check for this.methodName calls
  const thisCallRegex = new RegExp(`this\\.${methodName}\\s*\\(`, 'g');
  // Check for await calls
  const awaitCallRegex = new RegExp(`await\\s+.*\\.${methodName}\\s*\\(`, 'g');
  
  return directCallRegex.test(content) || thisCallRegex.test(content) || awaitCallRegex.test(content);
}

// Service files to analyze
const services = [
  {
    name: "ChatService",
    file: "src/services/chat.ts",
    instanceName: "chatService"
  },
  {
    name: "PDFService", 
    file: "src/services/pdf.ts",
    instanceName: "pdfService"
  },
  {
    name: "VectorStoreService",
    file: "src/services/vector-store.ts", 
    instanceName: "vectorStore"
  },
  {
    name: "GeminiService",
    file: "src/services/gemini.ts",
    instanceName: "geminiService"
  }
];

// Files to check for usage
const usageFiles = [
  "src/app.ts",
  "src/services/chat.ts",
  "src/services/pdf.ts", 
  "src/services/vector-store.ts",
  "src/services/gemini.ts"
];

console.log("1. ANALYZING SERVICE METHODS...\n");

const allMethods = {};

// Extract methods from each service
services.forEach(service => {
  console.log(`📋 Analyzing ${service.name} (${service.file})`);
  
  const content = readFile(service.file);
  if (!content) return;
  
  const methods = extractClassMethods(content, service.name);
  allMethods[service.name] = methods;
  
  console.log(`   Found ${methods.length} methods: ${methods.join(", ")}`);
  console.log("");
});

console.log("2. CHECKING METHOD USAGE...\n");

// Read all usage files
const usageContents = {};
usageFiles.forEach(file => {
  usageContents[file] = readFile(file);
});

// Check usage for each service
services.forEach(service => {
  console.log(`🔍 Checking usage of ${service.name} methods:`);
  
  const methods = allMethods[service.name] || [];
  const usedMethods = [];
  const unusedMethods = [];
  
  methods.forEach(method => {
    let isUsed = false;
    let usageLocations = [];
    
    // Check in all files
    Object.keys(usageContents).forEach(file => {
      const content = usageContents[file];
      if (content && isMethodUsed(content, method, service.instanceName)) {
        isUsed = true;
        usageLocations.push(path.basename(file));
      }
    });
    
    if (isUsed) {
      usedMethods.push({ method, locations: usageLocations });
    } else {
      unusedMethods.push(method);
    }
  });
  
  console.log(`   ✅ Used methods (${usedMethods.length}):`);
  usedMethods.forEach(({ method, locations }) => {
    console.log(`      ${method} - used in: ${locations.join(", ")}`);
  });
  
  if (unusedMethods.length > 0) {
    console.log(`   ⚠️  Potentially unused methods (${unusedMethods.length}):`);
    unusedMethods.forEach(method => {
      console.log(`      ${method}`);
    });
  } else {
    console.log(`   ✅ All methods appear to be used`);
  }
  
  console.log("");
});

console.log("3. SUMMARY...\n");

let totalMethods = 0;
let totalUsed = 0;
let totalUnused = 0;

services.forEach(service => {
  const methods = allMethods[service.name] || [];
  totalMethods += methods.length;
  
  const usedCount = methods.filter(method => {
    return Object.values(usageContents).some(content => 
      content && isMethodUsed(content, method, service.instanceName)
    );
  }).length;
  
  totalUsed += usedCount;
  totalUnused += (methods.length - usedCount);
});

console.log(`📊 Total methods analyzed: ${totalMethods}`);
console.log(`✅ Used methods: ${totalUsed}`);
console.log(`⚠️  Potentially unused methods: ${totalUnused}`);

if (totalUnused > 0) {
  console.log(`\n💡 Note: Some methods might be used indirectly or in test files not analyzed.`);
  console.log(`   Review unused methods carefully before removing them.`);
}

console.log("\n=== ANALYSIS COMPLETE ===");
