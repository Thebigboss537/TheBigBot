import { promises as fs } from 'fs';
import { config } from '../utils/config';

const CLIENT_ID: string = config.CLIENTID || '';
const CLIENT_SECRET: string = config.CLIENTSECRET || '';

interface Token {
  access_token: string;
  refresh_token: string;
  expiry_time: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export class TokenManager {
  private tokenFile: string;
  private token: Token | null;

  constructor() {
    this.tokenFile = 'token.json';
    this.token = null;
  }

  async loadToken(): Promise<void> {
    console.log("ruta del archivo: ", this.tokenFile);
    try {
      const data = await fs.readFile(this.tokenFile, 'utf8');
      this.token = JSON.parse(data);
    } catch (error) {
      console.log('No existing token found. Will obtain a new one.');
      throw new Error('No existing token found. Will obtain a new one.');
      
    }
  }

  async saveToken(): Promise<void> {
    console.log("entro a savetoken");
    await fs.writeFile(this.tokenFile, JSON.stringify(this.token), 'utf8');
  }

  async getValidToken(): Promise<string> {
    await this.loadToken();

    if (!this.token || this.isTokenExpired()) {
      if (this.token && this.token.refresh_token) {
        await this.refreshToken();
      } else {
        throw new Error('No valid token or refresh token. Please obtain a new authorization code.');
      }
    }

    return this.token.access_token;
  }

  private isTokenExpired(): boolean {
    return this.token ? Date.now() >= this.token.expiry_time : true;
  }

  async refreshToken(): Promise<void> {
    if (!this.token) {
      throw new Error('No token to refresh');
    }
    const { access_token, refresh_token, expires_in } = await refreshToken(this.token.refresh_token);
    this.token = {
      access_token,
      refresh_token,
      expiry_time: Date.now() + expires_in * 1000
    };
    await this.saveToken();
  }

  async setInitialToken(authCode: string): Promise<void> {
    const { access_token, refresh_token, expires_in } = await getInitialToken(authCode);
    this.token = {
      access_token,
      refresh_token,
      expiry_time: Date.now() + expires_in * 1000
    };
    await this.saveToken();
  }
}

async function refreshToken(refresh_token: string): Promise<TokenResponse> {
  const tokenUrl = 'https://id.twitch.tv/oauth2/token';
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: refresh_token,
    grant_type: 'refresh_token'
  });

  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      body: body
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log('Token refreshed successfully');
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in
    };
  } catch (error) {
    console.error('Error refreshing token:', error);
    throw error;
  }
}

async function getInitialToken(authCode: string): Promise<TokenResponse> {
  const tokenUrl = 'https://id.twitch.tv/oauth2/token';
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code: authCode,
    grant_type: 'authorization_code',
    redirect_uri: 'http://localhost:3000/resultados'
  });

  console.log(`Attempting to obtain token with auth code: ${authCode.substring(0, 5)}...`);

  try {
    console.log(`Sending POST request to ${tokenUrl}`);
    const response = await fetch(tokenUrl, {
      method: 'POST',
      body: body,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    console.log(`Received response with status: ${response.status}`);

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`Error response body: ${errorBody}`);
      throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}`);
    }

    const data = await response.json();
    console.log('Token data received. Parsing...');

    if (!data.access_token || !data.refresh_token || !data.expires_in) {
      console.error('Incomplete token data received:', data);
      throw new Error('Incomplete token data received from Twitch');
    }

    console.log('Token obtained successfully');
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in
    };
  } catch (error) {
    console.error('Detailed error in getInitialToken:');
    if (error instanceof Error) {
      console.error(`Name: ${error.name}`);
      console.error(`Message: ${error.message}`);
      console.error(`Stack: ${error.stack}`);
    } else {
      console.error('Unexpected error type:', error);
    }
    throw error;
  }
}