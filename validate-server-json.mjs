#!/usr/bin/env node

import Ajv from 'ajv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function validateServerJson() {
  try {
    // Read server.json
    const serverJsonPath = join(__dirname, 'server.json');
    const serverJson = JSON.parse(readFileSync(serverJsonPath, 'utf-8'));
    
    console.log('📄 Loaded server.json');
    console.log(`   Schema: ${serverJson.$schema}`);
    console.log(`   Name: ${serverJson.name}`);
    console.log(`   Version: ${serverJson.version}\n`);
    
    // Fetch the schema
    console.log('⬇️  Fetching schema...');
    const schemaUrl = serverJson.$schema;
    const schemaResponse = await fetch(schemaUrl);
    
    if (!schemaResponse.ok) {
      throw new Error(`Failed to fetch schema: ${schemaResponse.status} ${schemaResponse.statusText}`);
    }
    
    const schema = await schemaResponse.json();
    console.log('✅ Schema fetched successfully\n');
    
    // Validate
    console.log('🔍 Validating server.json against schema...');
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    const valid = validate(serverJson);
    
    if (valid) {
      console.log('✅ server.json is valid!\n');
      console.log('📦 Package configuration:');
      serverJson.packages.forEach((pkg, idx) => {
        console.log(`   ${idx + 1}. ${pkg.registryType}: ${pkg.identifier}@${pkg.version}`);
        console.log(`      Transport: ${pkg.transport.type}`);
      });
      console.log('');
      return true;
    } else {
      console.error('❌ Validation failed!\n');
      console.error('Errors:');
      validate.errors.forEach((error, idx) => {
        console.error(`   ${idx + 1}. ${error.instancePath || '/'}: ${error.message}`);
        if (error.params) {
          console.error(`      Details: ${JSON.stringify(error.params)}`);
        }
      });
      console.error('');
      return false;
    }
  } catch (error) {
    console.error('❌ Error during validation:', error.message);
    return false;
  }
}

// Run validation
const isValid = await validateServerJson();
process.exit(isValid ? 0 : 1);
