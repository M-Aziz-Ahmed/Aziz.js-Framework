// Database connection helper
// This is a mock - replace with real database connection

let isConnected = false;

async function connectDB() {
    if (isConnected) {
        console.log('✅ Using existing database connection');
        return;
    }

    try {
        // In production, connect to real database here:
        // await mongoose.connect(process.env.MONGODB_URI);
        // or
        // db = await new Database(process.env.DATABASE_URL);
        
        console.log('✅ Database connected (mock)');
        isConnected = true;
    } catch (error) {
        console.error('❌ Database connection failed:', error);
        throw error;
    }
}

module.exports = connectDB;

// Example usage with MongoDB:
/*
const mongoose = require('mongoose');

async function connectDB() {
    if (mongoose.connections[0].readyState) {
        return;
    }

    await mongoose.connect(process.env.MONGODB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    });
    
    console.log('✅ MongoDB connected');
}

module.exports = connectDB;
*/

// Example usage with PostgreSQL:
/*
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function connectDB() {
    try {
        await pool.query('SELECT NOW()');
        console.log('✅ PostgreSQL connected');
    } catch (error) {
        console.error('❌ PostgreSQL connection failed:', error);
        throw error;
    }
}

module.exports = connectDB;
*/
