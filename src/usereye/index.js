'use strict';

const { UserEye, safeName, TOOL_VERSION, SUPPORTED_BROWSERS } = require('./user-eye');
const { AdaptiveExplorer, MODES, classifyPage, mergeBudget } = require('./adaptive-explorer');
const { ProjectAdapter } = require('./project-adapter');
const { ProtocolRunner } = require('./protocol-runner');
const { CodeQualityAnalyzer } = require('./code-quality');
const { loadConfig, sanitizeConfig, writeResolvedConfig, DEFAULT_CONFIG } = require('./config');
const { loadPatterns } = require('./patterns');
const { writeReports } = require('./report');
const { buildSarif, writeSarif } = require('./sarif');
const { buildExecutionPlan } = require('./execution-plan');
const { buildIssuePayloads } = require('./issue-export');

module.exports = {
  UserEye,
  safeName,
  TOOL_VERSION,
  SUPPORTED_BROWSERS,
  AdaptiveExplorer,
  MODES,
  classifyPage,
  mergeBudget,
  ProjectAdapter,
  ProtocolRunner,
  CodeQualityAnalyzer,
  loadConfig,
  sanitizeConfig,
  writeResolvedConfig,
  DEFAULT_CONFIG,
  loadPatterns,
  writeReports,
  buildSarif,
  writeSarif,
  buildExecutionPlan,
  buildIssuePayloads,
};
