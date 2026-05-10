import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

interface RegisterRequest {
  email: string;
  password: string;
  full_name: string;
  tenant_name: string;
  tenant_slug: string;
  tax_id?: string;
  country_code?: string;
}

export async function POST(request: NextRequest) {
  try {
    // Verify environment variables at runtime
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl) {
      return NextResponse.json(
        { detail: 'Missing SUPABASE_URL configuration' },
        { status: 500 }
      );
    }

    if (!supabaseServiceKey) {
      return NextResponse.json(
        { detail: 'Missing SUPABASE_SERVICE_ROLE_KEY configuration. Contact administrator.' },
        { status: 500 }
      );
    }

    // Create Supabase client with service key for admin operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = (await request.json()) as RegisterRequest;

    const { email, password, full_name, tenant_name, tenant_slug, tax_id, country_code } = body;

    // Validations
    if (!email || !password || !full_name || !tenant_name || !tenant_slug) {
      return NextResponse.json(
        { detail: 'Missing required fields' },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { detail: 'Password must be at least 8 characters' },
        { status: 400 }
      );
    }

    // Create auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authError) {
      return NextResponse.json(
        { detail: authError.message },
        { status: 400 }
      );
    }

    const userId = authData.user?.id;
    if (!userId) {
      return NextResponse.json(
        { detail: 'Failed to create user' },
        { status: 500 }
      );
    }

    // Create tenant
    const { data: tenantData, error: tenantError } = await supabase
      .from('tenants')
      .insert({
        name: tenant_name,
        slug: tenant_slug,
        tax_id: tax_id || null,
        country_code: country_code || 'CO',
      })
      .select()
      .single();

    if (tenantError) {
      // Clean up auth user on failure
      await supabase.auth.admin.deleteUser(userId);
      return NextResponse.json(
        { detail: tenantError.message },
        { status: 400 }
      );
    }

    const tenantId = tenantData?.id;

    // Create user profile
    const { error: profileError } = await supabase
      .from('users')
      .insert({
        id: userId,
        tenant_id: tenantId,
        email,
        full_name,
        role: 'tenant_admin',
      });

    if (profileError) {
      // Clean up on failure
      await supabase.auth.admin.deleteUser(userId);
      await supabase.from('tenants').delete().eq('id', tenantId);
      return NextResponse.json(
        { detail: profileError.message },
        { status: 400 }
      );
    }

    // After successful registration, user should login with their credentials
    // Return success message and user info
    return NextResponse.json(
      {
        message: 'User registered successfully. Please login with your credentials.',
        user: {
          id: userId,
          email,
          full_name,
          tenant_id: tenantId,
          role: 'tenant_admin',
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Register error:', error);
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
