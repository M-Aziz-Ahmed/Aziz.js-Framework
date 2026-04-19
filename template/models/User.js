// User Model
// This is a mock - replace with real database model

// Mock in-memory database
let users = [
    { _id: '1', name: 'Aziz Ahmed', email: 'aziz@example.com', role: 'admin', phone: '123-456-7890' },
    { _id: '2', name: 'John Doe', email: 'john@example.com', role: 'user', phone: '098-765-4321' }
];

class User {
    // Find one user
    static async findOne(query) {
        const user = users.find(u => {
            return Object.keys(query).every(key => u[key] === query[key]);
        });
        return user || null;
    }

    // Find by ID
    static async findById(id) {
        return users.find(u => u._id === id) || null;
    }

    // Find all users
    static async find(query = {}) {
        if (Object.keys(query).length === 0) {
            return users;
        }
        return users.filter(u => {
            return Object.keys(query).every(key => u[key] === query[key]);
        });
    }

    // Create new user
    static async create(userData) {
        const newUser = {
            _id: String(users.length + 1),
            ...userData,
            createdAt: new Date().toISOString()
        };
        users.push(newUser);
        return newUser;
    }

    // Update user
    static async findByIdAndUpdate(id, updates) {
        const index = users.findIndex(u => u._id === id);
        if (index === -1) return null;
        
        users[index] = { ...users[index], ...updates, updatedAt: new Date().toISOString() };
        return users[index];
    }

    // Delete user
    static async findByIdAndDelete(id) {
        const index = users.findIndex(u => u._id === id);
        if (index === -1) return null;
        
        const deleted = users.splice(index, 1)[0];
        return deleted;
    }

    // Select specific fields
    select(fields) {
        // This is a chainable method for field selection
        // In real Mongoose, this would be: User.findOne().select('name email')
        return this;
    }
}

module.exports = User;

// Example usage with Mongoose:
/*
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String,
        required: true
    },
    role: {
        type: String,
        enum: ['user', 'admin'],
        default: 'user'
    },
    phone: String
}, {
    timestamps: true
});

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
*/
