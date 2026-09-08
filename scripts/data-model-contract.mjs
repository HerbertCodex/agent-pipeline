import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";

const NORMAL_FORMS = ["1NF", "2NF", "3NF", "BCNF", "4NF", "5NF"];
const WORKLOADS = new Set(["oltp", "olap", "mixed"]);
const DATA_CLASSES = new Set(["public", "internal", "confidential", "restricted"]);
const OWNERSHIP = new Set(["global", "user", "tenant", "system"]);
const REPLAY = new Set(["per_issue", "closure"]);
const FILTER_OPERATORS = new Set(["eq", "in", "lt", "lte", "gt", "gte", "contains", "prefix"]);

function object(value, label) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function text(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function list(value, label, { empty = true } = {}) {
  if (!Array.isArray(value) || (!empty && value.length === 0)) throw new Error(`${label} must be ${empty ? "a list" : "a non-empty list"}`);
  return value;
}

function bool(value, label) {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean`);
  return value;
}

function number(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive number`);
  return value;
}

function sameMembers(left, right) {
  return left.length === right.length && left.every((item) => right.includes(item));
}

function includesKey(fields, keys) {
  return keys.some((key) => key.every((field) => fields.includes(field)));
}

function committedPath(root, value, label) {
  text(value, label);
  if (isAbsolute(value)) throw new Error(`${label} must be relative to the project`);
  const path = resolve(root, value);
  const base = resolve(root);
  if (path !== base && !path.startsWith(`${base}${sep}`)) throw new Error(`${label} escapes the project: ${value}`);
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`${label} does not name an existing file: ${value}`);
  return value;
}

function fieldsExist(names, fields, label) {
  for (const name of names) if (!fields.has(name)) throw new Error(`${label} names unknown field ${name}`);
}

function keysOf(entity, fields, label) {
  const primary = list(entity.primary_key, `${label}.primary_key`, { empty: false }).map((field, index) => text(field, `${label}.primary_key[${index}]`));
  fieldsExist(primary, fields, `${label}.primary_key`);
  const candidates = list(entity.candidate_keys ?? [], `${label}.candidate_keys`).map((key, index) => {
    const candidate = list(key, `${label}.candidate_keys[${index}]`, { empty: false }).map((field, fieldIndex) => text(field, `${label}.candidate_keys[${index}][${fieldIndex}]`));
    fieldsExist(candidate, fields, `${label}.candidate_keys[${index}]`);
    return [...new Set(candidate)];
  });
  const all = [primary, ...candidates];
  if (all.some((key, index) => all.some((other, otherIndex) => index !== otherIndex && sameMembers(key, other)))) {
    throw new Error(`${label} repeats a primary or candidate key`);
  }
  return all;
}

function validateDependencies(entity, fields, keys, target, label, root) {
  const dependencies = list(entity.functional_dependencies, `${label}.functional_dependencies`, { empty: false });
  const prime = new Set(keys.flat());
  const violations = [];
  for (const [index, raw] of dependencies.entries()) {
    const dependency = object(raw, `${label}.functional_dependencies[${index}]`);
    const determinant = list(dependency.determinant, `${label}.functional_dependencies[${index}].determinant`, { empty: false });
    const dependent = list(dependency.dependent, `${label}.functional_dependencies[${index}].dependent`, { empty: false });
    fieldsExist(determinant, fields, `${label}.functional_dependencies[${index}].determinant`);
    fieldsExist(dependent, fields, `${label}.functional_dependencies[${index}].dependent`);
    const nonTrivial = dependent.filter((field) => !determinant.includes(field));
    if (nonTrivial.length === 0) continue;
    const superkey = includesKey(determinant, keys);
    const partial = keys.some((key) => key.length > 1 && determinant.length < key.length && determinant.every((field) => key.includes(field)));
    if (partial && nonTrivial.some((field) => !prime.has(field))) {
      violations.push({ form: "2NF", dependency: `${determinant.join("+")} -> ${nonTrivial.join("+")}` });
    }
    if (!superkey && nonTrivial.some((field) => !prime.has(field))) {
      violations.push({ form: "3NF", dependency: `${determinant.join("+")} -> ${nonTrivial.join("+")}` });
    }
    if (!superkey) violations.push({ form: "BCNF", dependency: `${determinant.join("+")} -> ${nonTrivial.join("+")}` });
  }
  if (["4NF", "5NF"].includes(target)) {
    for (const [index, raw] of list(entity.multivalued_dependencies ?? [], `${label}.multivalued_dependencies`).entries()) {
      const dependency = object(raw, `${label}.multivalued_dependencies[${index}]`);
      const determinant = list(dependency.determinant, `${label}.multivalued_dependencies[${index}].determinant`, { empty: false });
      const dependent = list(dependency.dependent, `${label}.multivalued_dependencies[${index}].dependent`, { empty: false });
      fieldsExist([...determinant, ...dependent], fields, `${label}.multivalued_dependencies[${index}]`);
      if (!includesKey(determinant, keys)) violations.push({ form: "4NF", dependency: `${determinant.join("+")} ->> ${dependent.join("+")}` });
    }
  }
  if (target === "5NF") {
    for (const [index, raw] of list(entity.join_dependencies ?? [], `${label}.join_dependencies`).entries()) {
      const dependency = object(raw, `${label}.join_dependencies[${index}]`);
      const components = list(dependency.components, `${label}.join_dependencies[${index}].components`, { empty: false });
      for (const [componentIndex, component] of components.entries()) {
        list(component, `${label}.join_dependencies[${index}].components[${componentIndex}]`, { empty: false });
        fieldsExist(component, fields, `${label}.join_dependencies[${index}].components[${componentIndex}]`);
      }
      if (dependency.lossless !== true || typeof dependency.evidence !== "string") {
        violations.push({ form: "5NF", dependency: `join dependency ${index + 1} has no lossless-decomposition evidence` });
      } else committedPath(root, dependency.evidence, `${label}.join_dependencies[${index}].evidence`);
    }
  }
  const targetRank = NORMAL_FORMS.indexOf(target);
  const blocking = violations.filter((violation) => NORMAL_FORMS.indexOf(violation.form) <= targetRank);
  return { violations, blocking };
}

function timestampException(policy, entity, root) {
  const exception = (policy.exceptions ?? []).find((item) => item?.entity === entity.name);
  if (!exception) return false;
  text(exception.reason, `policy.timestamps.exceptions.${entity.name}.reason`);
  committedPath(root, exception.decision, `policy.timestamps.exceptions.${entity.name}.decision`);
  return true;
}

function validateEntity(entity, index, policy, root, denormalizedEntities) {
  const label = `entities[${index}]`;
  object(entity, label);
  text(entity.name, `${label}.name`);
  const declaredFields = list(entity.fields, `${label}.fields`, { empty: false });
  const fields = new Map();
  for (const [fieldIndex, field] of declaredFields.entries()) {
    object(field, `${label}.fields[${fieldIndex}]`);
    text(field.name, `${label}.fields[${fieldIndex}].name`);
    text(field.type, `${label}.fields[${fieldIndex}].type`);
    if (fields.has(field.name)) throw new Error(`${label} repeats field ${field.name}`);
    if (field.classification != null && !DATA_CLASSES.has(field.classification)) throw new Error(`${label}.${field.name}.classification is unsupported`);
    for (const flag of ["nullable", "filterable", "sortable"]) if (field[flag] != null) bool(field[flag], `${label}.${field.name}.${flag}`);
    fields.set(field.name, field);
  }
  const fieldNames = new Set(fields.keys());
  const keys = keysOf(entity, fieldNames, label);
  for (const field of keys[0]) if (fields.get(field).nullable !== false) throw new Error(`${label} primary-key field ${field} must set nullable false`);

  const normalization = object(entity.normalization, `${label}.normalization`);
  if (normalization.atomic_values !== true || normalization.no_repeating_groups !== true) {
    throw new Error(`${label}.normalization must attest atomic_values and no_repeating_groups`);
  }
  if (!NORMAL_FORMS.includes(normalization.normal_form)) throw new Error(`${label}.normalization.normal_form is unsupported`);
  if (NORMAL_FORMS.indexOf(normalization.normal_form) < NORMAL_FORMS.indexOf(policy.normalization.target) && !denormalizedEntities.has(entity.name)) {
    throw new Error(`${label} declares ${normalization.normal_form}, below target ${policy.normalization.target}`);
  }
  const dependencyResult = validateDependencies(entity, fieldNames, keys, normalization.normal_form, label, root);
  const primeFields = new Set(keys.flat());
  const dependentFields = new Set(entity.functional_dependencies.flatMap((dependency) => dependency.dependent ?? []));
  for (const field of fieldNames) {
    if (!primeFields.has(field) && !dependentFields.has(field)) throw new Error(`${label}.functional_dependencies does not cover non-key field ${field}`);
  }
  if (dependencyResult.blocking.length > 0) {
    const first = dependencyResult.blocking[0];
    throw new Error(`${label} violates ${first.form}: ${first.dependency}`);
  }

  const ownership = object(entity.ownership, `${label}.ownership`);
  if (!OWNERSHIP.has(ownership.scope)) throw new Error(`${label}.ownership.scope is unsupported`);
  if (["user", "tenant"].includes(ownership.scope)) {
    text(ownership.field, `${label}.ownership.field`);
    fieldsExist([ownership.field], fieldNames, `${label}.ownership`);
    if (!new Set(["enabled", "not_applicable"]).has(ownership.row_level_security)) throw new Error(`${label}.ownership.row_level_security must be enabled or not_applicable`);
    if (ownership.row_level_security === "not_applicable") committedPath(root, ownership.decision, `${label}.ownership.decision`);
  }

  const exempt = timestampException(policy.timestamps, entity, root);
  if (!exempt) {
    for (const name of [policy.timestamps.created_at, policy.timestamps.updated_at]) {
      if (!fields.has(name) || fields.get(name).nullable !== false) throw new Error(`${label} must carry non-null ${name}`);
    }
  }

  const indexes = new Map();
  for (const [index, raw] of list(entity.indexes ?? [], `${label}.indexes`).entries()) {
    const item = object(raw, `${label}.indexes[${index}]`);
    text(item.name, `${label}.indexes[${index}].name`);
    if (indexes.has(item.name)) throw new Error(`${label} repeats index ${item.name}`);
    const indexFields = list(item.fields, `${label}.indexes[${index}].fields`, { empty: false });
    fieldsExist(indexFields, fieldNames, `${label}.indexes[${index}]`);
    indexes.set(item.name, item);
  }
  return { entity, fields, keys, indexes, dependencyResult };
}

function validatePolicy(contract, root) {
  const policy = object(contract.policy, "policy");
  const normalization = object(policy.normalization, "policy.normalization");
  if (!NORMAL_FORMS.includes(normalization.target) || NORMAL_FORMS.indexOf(normalization.target) < NORMAL_FORMS.indexOf("3NF")) {
    throw new Error("policy.normalization.target must be 3NF or stronger");
  }
  if (normalization.dependencies_complete !== true) throw new Error("policy.normalization.dependencies_complete must be true after domain review");
  committedPath(root, normalization.exceptions, "policy.normalization.exceptions");

  const timestamps = object(policy.timestamps, "policy.timestamps");
  if (!new Set(["database", "application"]).has(timestamps.authority)) throw new Error("policy.timestamps.authority must be database or application");
  if (timestamps.timezone !== "UTC") throw new Error("policy.timestamps.timezone must be UTC");
  text(timestamps.created_at, "policy.timestamps.created_at");
  text(timestamps.updated_at, "policy.timestamps.updated_at");
  if (timestamps.created_at === timestamps.updated_at) throw new Error("created_at and updated_at must differ");
  list(timestamps.exceptions ?? [], "policy.timestamps.exceptions");

  const audit = object(policy.audit, "policy.audit");
  if (audit.enabled !== true || audit.append_only !== true || audit.secrets_excluded !== true) {
    throw new Error("policy.audit must enable append-only, secret-free audit evidence");
  }
  text(audit.entity, "policy.audit.entity");
  for (const key of ["actor", "action", "resource_type", "resource_id", "occurred_at", "correlation_id"]) text(audit[key], `policy.audit.${key}`);
  committedPath(root, audit.retention_decision, "policy.audit.retention_decision");

  const security = object(policy.security, "policy.security");
  if (security.parameterized_queries !== true) throw new Error("policy.security.parameterized_queries must be true");
  for (const key of ["least_privilege", "separate_migration_identity"]) {
    if (![true, "not_applicable"].includes(security[key])) throw new Error(`policy.security.${key} must be true or not_applicable`);
  }
  if (!new Set(["required", "not_applicable"]).has(security.tls) || security.public_network !== false) throw new Error("policy.security must review TLS and refuse a public database network");
  if (!new Set(["environment", "secret_manager"]).has(security.secrets_source)) throw new Error("policy.security.secrets_source is unsupported");
  if (!DATA_CLASSES.has(security.default_classification)) throw new Error("policy.security.default_classification is unsupported");
  if (security.authorization_default !== "deny") throw new Error("policy.security.authorization_default must be deny");
  number(security.connection_limit, "policy.security.connection_limit");
  number(security.statement_timeout_ms, "policy.security.statement_timeout_ms");
  committedPath(root, security.decision, "policy.security.decision");

  const migrations = object(policy.migrations, "policy.migrations");
  if (migrations.strategy !== "expand_contract" || migrations.rollback_or_forward_fix !== true || migrations.lock_budget_ms == null) {
    throw new Error("policy.migrations must use expand_contract, require recovery, and declare lock_budget_ms");
  }
  number(migrations.lock_budget_ms, "policy.migrations.lock_budget_ms");
  committedPath(root, migrations.decision, "policy.migrations.decision");

  const recovery = object(policy.recovery, "policy.recovery");
  if (recovery.backups_encrypted !== true || recovery.restore_target !== "isolated") {
    throw new Error("policy.recovery must encrypt backups and restore only to an isolated target");
  }
  number(recovery.recovery_time_objective_minutes, "policy.recovery.recovery_time_objective_minutes");
  number(recovery.recovery_point_objective_minutes, "policy.recovery.recovery_point_objective_minutes");
  committedPath(root, recovery.retention_decision, "policy.recovery.retention_decision");
  return policy;
}

function validateProofs(contract, config) {
  const proofs = object(contract.proofs, "proofs");
  const replayByGate = new Map();
  for (const name of ["anomalies", "authorization", "performance", "database_security", "backup_restore"]) {
    const proof = object(proofs[name], `proofs.${name}`);
    text(proof.gate, `proofs.${name}.gate`);
    if (!REPLAY.has(proof.replay)) throw new Error(`proofs.${name}.replay must be per_issue or closure`);
    if (["anomalies", "authorization", "database_security"].includes(name) && proof.replay !== "per_issue") {
      throw new Error(`proofs.${name} must replay per_issue`);
    }
    if (replayByGate.has(proof.gate) && replayByGate.get(proof.gate) !== proof.replay) throw new Error(`proof gate ${proof.gate} cannot have conflicting replay points`);
    replayByGate.set(proof.gate, proof.replay);
    if (config && typeof config.commands?.[proof.gate] !== "string") throw new Error(`proofs.${name}.gate names undeclared command ${proof.gate}`);
  }
  return proofs;
}

function validateRelations(contract, entities) {
  for (const [index, raw] of list(contract.relations ?? [], "relations").entries()) {
    const relation = object(raw, `relations[${index}]`);
    const from = object(relation.from, `relations[${index}].from`);
    const to = object(relation.to, `relations[${index}].to`);
    const fromEntity = entities.get(from.entity);
    const toEntity = entities.get(to.entity);
    if (!fromEntity || !toEntity) throw new Error(`relations[${index}] names an unknown entity`);
    const fromFields = list(from.fields, `relations[${index}].from.fields`, { empty: false });
    const toFields = list(to.fields, `relations[${index}].to.fields`, { empty: false });
    fieldsExist(fromFields, new Set(fromEntity.fields.keys()), `relations[${index}].from`);
    fieldsExist(toFields, new Set(toEntity.fields.keys()), `relations[${index}].to`);
    if (fromFields.length !== toFields.length) throw new Error(`relations[${index}] endpoints must have the same arity`);
    if (!includesKey(toFields, toEntity.keys) || !toEntity.keys.some((key) => sameMembers(key, toFields))) {
      throw new Error(`relations[${index}] target must be a primary or candidate key`);
    }
    if (!new Set(["one-to-one", "many-to-one"]).has(relation.cardinality)) throw new Error(`relations[${index}].cardinality is unsupported`);
    for (let fieldIndex = 0; fieldIndex < fromFields.length; fieldIndex += 1) {
      if (fromEntity.fields.get(fromFields[fieldIndex]).type !== toEntity.fields.get(toFields[fieldIndex]).type) throw new Error(`relations[${index}] endpoint types differ`);
    }
    if (relation.cardinality === "one-to-one" && !fromEntity.keys.some((key) => sameMembers(key, fromFields))) {
      throw new Error(`relations[${index}] one-to-one source must be a primary or candidate key`);
    }
    if (!new Set(["restrict", "cascade", "set_null", "no_action"]).has(relation.on_delete)) throw new Error(`relations[${index}].on_delete is unsupported`);
    if (relation.on_delete === "set_null" && fromFields.some((field) => fromEntity.fields.get(field).nullable !== true)) throw new Error(`relations[${index}] set_null source fields must be nullable`);
    if (!new Set(["restrict", "cascade", "no_action"]).has(relation.on_update)) throw new Error(`relations[${index}].on_update is unsupported`);
  }
}

function validateAccessPatterns(contract, entities, root, policy) {
  const ids = new Set();
  const coveredFilters = new Map();
  for (const [index, raw] of list(contract.access_patterns, "access_patterns", { empty: false }).entries()) {
    const access = object(raw, `access_patterns[${index}]`);
    text(access.id, `access_patterns[${index}].id`);
    if (ids.has(access.id)) throw new Error(`access_patterns repeats id ${access.id}`);
    ids.add(access.id);
    const entity = entities.get(access.entity);
    if (!entity) throw new Error(`access_patterns[${index}] names unknown entity ${access.entity}`);
    const filters = list(access.filters, `access_patterns[${index}].filters`);
    const sort = list(access.sort ?? [], `access_patterns[${index}].sort`);
    const select = list(access.select, `access_patterns[${index}].select`, { empty: false });
    fieldsExist([...filters, ...sort, ...select], new Set(entity.fields.keys()), `access_patterns[${index}]`);
    if (!new Set(["public", "authenticated", "admin", "system"]).has(access.audience)) throw new Error(`access_patterns[${index}].audience is unsupported`);
    if (access.audience === "public" && select.some((name) => (entity.fields.get(name).classification ?? policy.security.default_classification) !== "public")) {
      throw new Error(`access_patterns[${index}] exposes classified data to a public audience`);
    }
    const operators = object(access.operators, `access_patterns[${index}].operators`);
    for (const field of filters) {
      const allowed = list(operators[field], `access_patterns[${index}].operators.${field}`, { empty: false });
      for (const operator of allowed) if (!FILTER_OPERATORS.has(operator)) throw new Error(`access_patterns[${index}] uses unsupported filter operator ${operator}`);
    }
    for (const field of Object.keys(operators)) if (!filters.includes(field)) throw new Error(`access_patterns[${index}].operators names non-filter field ${field}`);
    if (!new Set(["cursor", "offset", "none"]).has(access.pagination)) throw new Error(`access_patterns[${index}].pagination is unsupported`);
    number(access.max_page_size, `access_patterns[${index}].max_page_size`);
    if (access.pagination === "cursor" && sort.length === 0) throw new Error(`access_patterns[${index}] cursor pagination needs a stable sort`);
    number(access.budget_ms, `access_patterns[${index}].budget_ms`);
    number(access.representative_rows, `access_patterns[${index}].representative_rows`);
    committedPath(root, access.plan_evidence, `access_patterns[${index}].plan_evidence`);
    if (access.supporting_index) {
      const indexDefinition = entity.indexes.get(access.supporting_index);
      if (!indexDefinition) throw new Error(`access_patterns[${index}] names unknown supporting index ${access.supporting_index}`);
      for (const field of [...filters, ...sort]) if (!indexDefinition.fields.includes(field)) throw new Error(`access_patterns[${index}] supporting index omits filter or sort field ${field}`);
    } else {
      const exception = object(access.index_exception, `access_patterns[${index}].index_exception`);
      text(exception.reason, `access_patterns[${index}].index_exception.reason`);
      committedPath(root, exception.decision, `access_patterns[${index}].index_exception.decision`);
    }
    if (["user", "tenant"].includes(entity.entity.ownership.scope) && access.audience !== "admin" && !filters.includes(entity.entity.ownership.field)) {
      throw new Error(`access_patterns[${index}] must filter by ownership field ${entity.entity.ownership.field}`);
    }
    const set = coveredFilters.get(access.entity) ?? new Set();
    filters.forEach((field) => set.add(field));
    coveredFilters.set(access.entity, set);
  }
  for (const [name, entity] of entities) {
    for (const field of entity.fields.values()) {
      if (field.filterable === true && !coveredFilters.get(name)?.has(field.name)) throw new Error(`${name}.${field.name} is filterable but has no access pattern`);
    }
  }
}

function validateDenormalizations(contract, entities, root) {
  for (const [index, raw] of list(contract.denormalizations ?? [], "denormalizations").entries()) {
    const item = object(raw, `denormalizations[${index}]`);
    const entity = entities.get(item.entity);
    if (!entity) throw new Error(`denormalizations[${index}] names unknown entity ${item.entity}`);
    const fields = list(item.fields, `denormalizations[${index}].fields`, { empty: false });
    fieldsExist(fields, new Set(entity.fields.keys()), `denormalizations[${index}]`);
    text(item.reason, `denormalizations[${index}].reason`);
    text(item.consistency_strategy, `denormalizations[${index}].consistency_strategy`);
    text(item.review_trigger, `denormalizations[${index}].review_trigger`);
    committedPath(root, item.decision, `denormalizations[${index}].decision`);
    const benchmark = object(item.benchmark, `denormalizations[${index}].benchmark`);
    committedPath(root, benchmark.evidence, `denormalizations[${index}].benchmark.evidence`);
    number(benchmark.representative_rows, `denormalizations[${index}].benchmark.representative_rows`);
    number(benchmark.before_ms, `denormalizations[${index}].benchmark.before_ms`);
    number(benchmark.after_ms, `denormalizations[${index}].benchmark.after_ms`);
    if (benchmark.after_ms >= benchmark.before_ms) throw new Error(`denormalizations[${index}] benchmark does not demonstrate a latency gain`);
  }
}

/** Validates the reviewed, stack-neutral relational data-governance contract. */
export function validateDataModelContract(value, { root = process.cwd(), config = null } = {}) {
  const contract = object(value, "data model contract");
  if (contract.version !== 1) throw new Error("data model contract version must be 1");
  text(contract.title, "title");
  const database = object(contract.database, "database");
  if (database.kind !== "relational") throw new Error("database.kind must be relational");
  if (!WORKLOADS.has(database.workload)) throw new Error("database.workload must be oltp, olap, or mixed");
  text(database.dialect, "database.dialect");
  committedPath(root, database.schema_source, "database.schema_source");
  const policy = validatePolicy(contract, root);
  const proofs = validateProofs(contract, config);

  const denormalizedEntities = new Set(list(contract.denormalizations ?? [], "denormalizations").map((item) => item?.entity));
  const entities = new Map();
  for (const [index, raw] of list(contract.entities, "entities", { empty: false }).entries()) {
    const validated = validateEntity(raw, index, policy, root, denormalizedEntities);
    if (entities.has(raw.name)) throw new Error(`entities repeats name ${raw.name}`);
    entities.set(raw.name, validated);
  }
  const auditEntity = entities.get(policy.audit.entity);
  if (!auditEntity) throw new Error(`policy.audit.entity is unknown: ${policy.audit.entity}`);
  fieldsExist(
    [policy.audit.actor, policy.audit.action, policy.audit.resource_type, policy.audit.resource_id, policy.audit.occurred_at, policy.audit.correlation_id],
    new Set(auditEntity.fields.keys()),
    "policy.audit",
  );
  validateRelations(contract, entities);
  validateAccessPatterns(contract, entities, root, policy);
  validateDenormalizations(contract, entities, root);

  return {
    contract,
    summary: {
      entities: entities.size,
      relations: (contract.relations ?? []).length,
      access_patterns: contract.access_patterns.length,
      denormalizations: (contract.denormalizations ?? []).length,
      target_normal_form: policy.normalization.target,
      workload: database.workload,
    },
    proofs,
  };
}

/** Reads and validates a contract file without guessing an ORM or SQL dialect. */
export function readDataModelContract(path, options = {}) {
  let value;
  try { value = JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { throw new Error(`data model contract unreadable: ${error.message}`); }
  return validateDataModelContract(value, options);
}
