# Budget App Setup Guide

This guide walks you through setting up the Budget App from scratch.

## Prerequisites

- ✅ Node.js v18+ installed
- ✅ Git installed
- ✅ Code editor (VS Code recommended)

## Step 1: Supabase Setup (5-10 minutes)

### 1.1 Create Supabase Account

1. Go to [https://supabase.com](https://supabase.com)
2. Click "Start your project" / Sign up
3. Use GitHub/Google sign-in or email

### 1.2 Create New Project

1. Click "New Project"
2. Choose organization (create one if needed)
3. Fill in project details:
   - **Name**: `budget-app` (or your choice)
   - **Database Password**: Generate a strong password (save it!)
   - **Region**: Choose closest to you
   - **Pricing Plan**: Free tier is perfect for learning
4. Click "Create new project"
5. Wait 2-3 minutes for provisioning

### 1.3 Get API Credentials

1. In your Supabase dashboard, click **"Settings"** (gear icon, bottom left)
2. Click **"API"** in the sidebar
3. Copy these values:
   - **Project URL** (e.g., `https://xxxxx.supabase.co`)
   - **Publishable key** (labeled "anon" in older UI - the long string under "Project API keys")
   - ⚠️ **Use publishable, NOT secret** - publishable is safe for client-side apps with RLS

### 1.4 Create Database Schema

1. In Supabase dashboard, click **"SQL Editor"** (left sidebar)
2. Click **"New query"**
3. Copy and paste the SQL from [`DATA_MODEL.md`](./DATA_MODEL.md), starting with "Step 1: Enable UUID extension"
4. Run each migration step one at a time:
   - Run Step 1 (UUID extension)
   - Run Step 2 (categories table)
   - Run Step 3 (budget_plans table)
   - Run Step 4 (budget_items table)
   - Run Step 5 (transactions table)
   - **(Optional for Phase 2)** Run Step 6 (recurring_templates)
5. Verify tables created: Click **"Table Editor"** in sidebar, you should see all tables

## Step 2: Local Project Setup

### 2.1 Install Dependencies

```bash
git clone https://github.com/SamGunvalson/budget-app.git
cd budget-app
npm install
```

### 2.2 Configure Environment Variables

1. Copy `.env.example` to `.env`:

   ```bash
   cp .env.example .env
   ```

2. Open `.env` in your editor

3. Replace the placeholder values:
   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your_long_anon_key_here
   ```

**⚠️ IMPORTANT**: Never commit `.env` to Git (it's already in `.gitignore`)

### 2.3 Start Development Server

```bash
npm run dev
```

You should see:

```
  VITE v5.x.x  ready in XXX ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Step 3: Verify Setup

### 3.1 Test Supabase Connection

The app will show a simple UI. If Supabase is configured correctly, you should be able to:

- Sign up for an account
- Log in
- See no console errors related to Supabase

### 3.2 Test Database

Open browser DevTools (F12) → Console. Try:

```javascript
// Should log the Supabase client
console.log(window.supabase);
```

If you see an object (not `undefined`), you're connected!

## Step 4: Default Data Setup (Optional)

### 4.1 Create Default Categories

After signing up/logging in, you can manually create categories, or run this SQL in Supabase SQL Editor:

```sql
-- Replace 'YOUR_USER_ID' with your actual user ID from auth.users table
INSERT INTO categories (user_id, name, type, color) VALUES
  ('YOUR_USER_ID', 'Groceries', 'needs', '#10B981'),
  ('YOUR_USER_ID', 'Rent/Mortgage', 'needs', '#EF4444'),
  ('YOUR_USER_ID', 'Utilities', 'needs', '#F59E0B'),
  ('YOUR_USER_ID', 'Transportation', 'needs', '#8B5CF6'),
  ('YOUR_USER_ID', 'Entertainment', 'wants', '#EC4899'),
  ('YOUR_USER_ID', 'Dining Out', 'wants', '#06B6D4'),
  ('YOUR_USER_ID', 'Emergency Fund', 'savings', '#14B8A6'),
  ('YOUR_USER_ID', 'Investments', 'savings', '#6366F1');
```

**To get your user ID:**

1. In Supabase dashboard, go to **Authentication** → **Users**
2. Find your email
3. Copy the UUID in the "ID" column

## Troubleshooting

### Build errors about missing modules

```bash
npm install
```

### "Module not found: recharts"

```bash
npm install recharts
```

### Supabase connection errors

1. Check `.env` file has correct `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
2. Restart dev server after changing `.env`
3. In Supabase dashboard → Settings → API, verify the keys match
4. Check browser console for specific error messages

### RLS Policy errors ("new row violates row-level security policy")

1. Make sure you're logged in
2. Verify RLS policies were created (Step 1.4)
3. In Supabase → Authentication → Policies, check each table has policies enabled

### Database tables not showing up

1. Go to Supabase → SQL Editor → History
2. Verify each migration ran successfully (green checkmark)
3. Re-run failed migrations

### Port 5173 already in use

Stop other Vite dev servers or use a different port:

```bash
npm run dev -- --port 5174
```

## Next Steps

Once setup is complete:

All phases are complete. See the root [README.md](../README.md) for the full feature list.

## Additional Resources

- [Supabase Docs](https://supabase.com/docs)
- [React Docs](https://react.dev)
- [Recharts Docs](https://recharts.org)
- [Tailwind CSS Docs](https://tailwindcss.com/docs)
- [Vite Docs](https://vitejs.dev)

## Getting Help

- Check browser DevTools console for errors
- Check Supabase dashboard logs (Logs section)
- Review `DATA_MODEL.md` for schema reference
- Ask AI with specific error messages and context

---

**Setup Version**: 1.0  
**Last Updated**: February 27, 2026
