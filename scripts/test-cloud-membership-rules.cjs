// Test inline candidate source with fabricated request/resource contexts only.
// No rule publishing, real Auth account, document reads/writes or credentials output.
const path = require('node:path');
const fs = require('node:fs');
const cliRoot = process.argv[2];
const projectId = process.argv[3];
if (!cliRoot || projectId !== 'dental-clinic-mmaakk888') throw new Error('Pass the installed Firebase CLI directory and the exact explicit dental-clinic-mmaakk888 project ID.');
const { Command } = require(path.join(cliRoot, 'lib/command.js'));
const { requireAuth } = require(path.join(cliRoot, 'lib/requireAuth.js'));
const { Client } = require(path.join(cliRoot, 'lib/apiv2.js'));
const { namedCases } = require('./cloudMembershipRulesCases.cjs');
(async () => {
  const options = { project: projectId, nonInteractive: true };
  await new Command('clinic:test-membership-rules').prepare(options);
  await requireAuth(options);
  const billing = await new Client({ urlPrefix: 'https://cloudbilling.googleapis.com', apiVersion: 'v1' }).get(`/projects/${projectId}/billingInfo`);
  if (billing.body.billingEnabled !== false || billing.body.billingAccountName) throw new Error('Unexpected billing.');
  const content = fs.readFileSync('firestore.membership.rules', 'utf8');
  if (/\b(?:get|exists|getAfter|existsAfter)\s*\(/u.test(content)) throw new Error('External document lookup prohibited in this test stage.');
  const response = await new Client({ urlPrefix: 'https://firebaserules.googleapis.com', apiVersion: 'v1' }).post(`/projects/${projectId}:test`, {
    source: { files: [{ name: 'firestore.membership.rules', content }] },
    testSuite: { testCases: namedCases.map(entry => entry.testCase) },
  }, { skipLog: { body: true, response: true } });
  const issues = (response.body.issues || []).map(issue => ({ severity: issue.severity, description: issue.description, sourcePosition: issue.sourcePosition }));
  const results = response.body.testResults || [];
  const externalCalls = results.reduce((total, result) => total + (result.functionCalls || []).length, 0);
  const failed = results.flatMap((result, index) => result.state === 'SUCCESS' ? [] : [{ name: namedCases[index]?.name, state: result.state }]);
  console.log(JSON.stringify({ issues, expectedTests: namedCases.length, results: results.length, passed: results.filter(result => result.state === 'SUCCESS').length, externalCalls, failed }));
  if (results.length !== namedCases.length || failed.length || externalCalls || issues.some(issue => issue.severity === 'ERROR')) process.exitCode = 1;
})().catch(error => { console.error(JSON.stringify({ status: 'rule-test-not-complete', httpStatus: error.status ?? error.context?.response?.statusCode ?? null })); process.exitCode = 1; });
