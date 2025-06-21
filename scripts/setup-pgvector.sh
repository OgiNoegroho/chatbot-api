#!/bin/bash

# Setup script for pgvector implementation
echo "=== PGVECTOR SETUP SCRIPT ==="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Check if running as root for system installations
check_root() {
    if [[ $EUID -eq 0 ]]; then
        print_warning "Running as root. This is required for system-wide pgvector installation."
    else
        print_info "Running as regular user. You may need sudo for some operations."
    fi
}

# Check PostgreSQL installation
check_postgresql() {
    echo "1. Checking PostgreSQL installation..."
    
    if command -v psql &> /dev/null; then
        PG_VERSION=$(psql --version | awk '{print $3}' | sed 's/\..*//')
        print_status "PostgreSQL found (version: $PG_VERSION)"
        
        # Check if PostgreSQL is running
        if pg_isready &> /dev/null; then
            print_status "PostgreSQL is running"
        else
            print_warning "PostgreSQL is not running. Please start it first."
            echo "  sudo systemctl start postgresql"
            exit 1
        fi
    else
        print_error "PostgreSQL not found. Please install PostgreSQL first."
        echo "  Ubuntu/Debian: sudo apt install postgresql postgresql-contrib"
        echo "  CentOS/RHEL: sudo yum install postgresql-server postgresql-contrib"
        exit 1
    fi
}

# Install pgvector
install_pgvector() {
    echo ""
    echo "2. Installing pgvector extension..."
    
    # Check if pgvector is already installed
    if psql -d postgres -c "SELECT 1 FROM pg_available_extensions WHERE name = 'vector';" 2>/dev/null | grep -q "1 row"; then
        print_status "pgvector extension is already available"
        return 0
    fi
    
    print_info "Installing pgvector from source..."
    
    # Install dependencies
    if command -v apt &> /dev/null; then
        # Ubuntu/Debian
        print_info "Installing build dependencies (Ubuntu/Debian)..."
        sudo apt update
        sudo apt install -y build-essential git postgresql-server-dev-all
    elif command -v yum &> /dev/null; then
        # CentOS/RHEL
        print_info "Installing build dependencies (CentOS/RHEL)..."
        sudo yum groupinstall -y "Development Tools"
        sudo yum install -y git postgresql-devel
    else
        print_warning "Unknown package manager. Please install build tools manually."
    fi
    
    # Clone and build pgvector
    TEMP_DIR=$(mktemp -d)
    cd "$TEMP_DIR"
    
    print_info "Cloning pgvector repository..."
    git clone --branch v0.5.1 https://github.com/pgvector/pgvector.git
    cd pgvector
    
    print_info "Compiling pgvector..."
    make
    
    print_info "Installing pgvector..."
    sudo make install
    
    # Cleanup
    cd /
    rm -rf "$TEMP_DIR"
    
    # Restart PostgreSQL to load the extension
    print_info "Restarting PostgreSQL..."
    sudo systemctl restart postgresql
    
    # Wait for PostgreSQL to start
    sleep 3
    
    # Verify installation
    if psql -d postgres -c "SELECT 1 FROM pg_available_extensions WHERE name = 'vector';" 2>/dev/null | grep -q "1 row"; then
        print_status "pgvector installed successfully"
    else
        print_error "pgvector installation failed"
        exit 1
    fi
}

# Setup Node.js dependencies
setup_nodejs() {
    echo ""
    echo "3. Setting up Node.js dependencies..."
    
    if command -v npm &> /dev/null; then
        print_info "Installing pgvector Node.js package..."
        npm install pgvector crypto
        print_status "Node.js dependencies installed"
    else
        print_error "npm not found. Please install Node.js first."
        exit 1
    fi
}

# Check environment variables
check_env() {
    echo ""
    echo "4. Checking environment variables..."
    
    if [[ -f .env ]]; then
        print_status ".env file found"
        
        # Check required variables
        if grep -q "DB_USER" .env && grep -q "DB_PASSWORD" .env && grep -q "DB_NAME" .env; then
            print_status "Database configuration found in .env"
        else
            print_warning "Database configuration incomplete in .env"
            echo "  Please ensure DB_USER, DB_PASSWORD, DB_NAME are set"
        fi
        
        if grep -q "GEMINI_API_KEY" .env; then
            print_status "Gemini API key found in .env"
        else
            print_warning "GEMINI_API_KEY not found in .env"
        fi
    else
        print_warning ".env file not found"
        echo "  Please create .env file with database and API configurations"
    fi
}

# Run database migration
run_migration() {
    echo ""
    echo "5. Running database migration..."
    
    if [[ -f migration.sql ]]; then
        print_info "Running migration script..."
        node scripts/migrate-to-pgvector.js
        
        if [[ $? -eq 0 ]]; then
            print_status "Database migration completed"
        else
            print_error "Database migration failed"
            exit 1
        fi
    else
        print_error "migration.sql not found"
        exit 1
    fi
}

# Build TypeScript
build_typescript() {
    echo ""
    echo "6. Building TypeScript..."
    
    if [[ -f tsconfig.json ]]; then
        npm run build
        
        if [[ $? -eq 0 ]]; then
            print_status "TypeScript build completed"
        else
            print_error "TypeScript build failed"
            exit 1
        fi
    else
        print_warning "tsconfig.json not found. Skipping TypeScript build."
    fi
}

# Run tests
run_tests() {
    echo ""
    echo "7. Running pgvector tests..."
    
    if [[ -f tests/test-pgvector.js ]]; then
        node tests/test-pgvector.js
        
        if [[ $? -eq 0 ]]; then
            print_status "pgvector tests passed"
        else
            print_warning "pgvector tests failed. Check the output above."
        fi
    else
        print_warning "test-pgvector.js not found. Skipping tests."
    fi
}

# Main setup function
main() {
    echo "This script will set up pgvector for your chatbot application."
    echo "It will:"
    echo "  - Check PostgreSQL installation"
    echo "  - Install pgvector extension"
    echo "  - Install Node.js dependencies"
    echo "  - Run database migration"
    echo "  - Build and test the application"
    echo ""
    
    read -p "Do you want to continue? (y/N): " -n 1 -r
    echo ""
    
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Setup cancelled."
        exit 0
    fi
    
    check_root
    check_postgresql
    install_pgvector
    setup_nodejs
    check_env
    run_migration
    build_typescript
    run_tests
    
    echo ""
    echo "=== SETUP COMPLETED ==="
    print_status "pgvector implementation is ready!"
    echo ""
    echo "Next steps:"
    echo "  1. Update your application to use ChatPgVectorService"
    echo "  2. Upload PDF documents to test vector search"
    echo "  3. Monitor performance and vector store statistics"
    echo ""
    echo "For more information, see PGVECTOR_IMPLEMENTATION_GUIDE.md"
}

# Run main function
main "$@"
