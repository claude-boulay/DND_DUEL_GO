import { Schema, model, type HydratedDocument } from 'mongoose';

export interface UserAttrs {
  username: string;
  email: string;
  password_hash: string;
  role: 'admin' | 'user';
}

export type UserDocument = HydratedDocument<UserAttrs>;

const userSchema = new Schema<UserAttrs>(
  {
    username: { type: String, required: true, trim: true, minlength: 3, maxlength: 32, unique: true },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    // `select: false` : jamais renvoyé par défaut, y compris via un `find()` négligent.
    password_hash: { type: String, required: true, select: false },
    role: { type: String, enum: ['admin', 'user'], default: 'user' },
  },
  { timestamps: true },
);

export const User = model<UserAttrs>('User', userSchema);
