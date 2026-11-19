import mongoose from 'mongoose';

let connectionPromise: Promise<typeof mongoose> | undefined;

export async function connectDatabase(): Promise<typeof mongoose> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');
  if (mongoose.connection.readyState === mongoose.STATES.connected) return mongoose;
  if (connectionPromise) return connectionPromise;

  mongoose.connection.on('error', error => {
    console.error('MongoDB connection error', error instanceof Error ? error.message : error);
  });
  mongoose.connection.on('disconnected', () => console.error('MongoDB disconnected'));

  connectionPromise = mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
    socketTimeoutMS: 45_000,
    maxPoolSize: 10
  }).then(connection => {
    console.log('MongoDB connected');
    return connection;
  }).catch(error => {
    connectionPromise = undefined;
    throw error;
  });

  return connectionPromise;
}

export async function disconnectDatabase(): Promise<void> {
  connectionPromise = undefined;
  if (mongoose.connection.readyState !== mongoose.STATES.disconnected) {
    await mongoose.disconnect();
  }
}
