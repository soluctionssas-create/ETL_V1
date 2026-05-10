import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

interface LoginRequest {
  email: string;
  password: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as LoginRequest;

    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { detail: 'Email and password required' },
        { status: 400 }
      );
    }

    // Authenticate with Supabase
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      return NextResponse.json(
        { detail: authError.message },
        { status: 401 }
      );
    }

    if (!authData.session) {
      return NextResponse.json(
        { detail: 'Failed to create session' },
        { status: 500 }
      );
    }

    // Get user profile from custom users table
    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    if (profileError) {
      console.error('Profile fetch error:', profileError);
      // User exists in auth but not in users table, create it
      const { error: createError } = await supabase
        .from('users')
        .insert({
          id: authData.user.id,
          email: authData.user.email || '',
          full_name: authData.user.user_metadata?.full_name || '',
          tenant_id: authData.user.user_metadata?.tenant_id,
          role: 'user',
        });

      if (createError) {
        console.error('Create user profile error:', createError);
      }
    }

    return NextResponse.json(
      {
        access_token: authData.session.access_token,
        refresh_token: authData.session.refresh_token,
        token_type: 'bearer',
        expires_in: authData.session.expires_in || 3600,
        user: {
          id: authData.user.id,
          email: authData.user.email,
          full_name: authData.user.user_metadata?.full_name || '',
          tenant_id: userProfile?.tenant_id || authData.user.user_metadata?.tenant_id,
          role: userProfile?.role || 'user',
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
