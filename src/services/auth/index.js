import { getBackendMode } from '../backend';
import * as local from './localAuthAdapter';
import * as supabase from './supabaseAuthAdapter';

const adapter = () => getBackendMode() === 'local' ? local : supabase;
export const getSession = (...args) => adapter().getSession(...args);
export const onAuthStateChange = (...args) => adapter().onAuthStateChange(...args);
export const signInWithPassword = (...args) => adapter().signInWithPassword(...args);
export const signUp = (...args) => adapter().signUp(...args);
export const signOut = (...args) => adapter().signOut(...args);
export const updatePassword = (...args) => adapter().updatePassword(...args);
export const getAccessToken = (...args) => adapter().getAccessToken(...args);
export const getSignupHealth = (...args) => adapter().getSignupHealth(...args);
