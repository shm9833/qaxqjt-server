'use strict';

/**
 * src/middleware/validate.js —— Joi 校验中间件（body/query/params）
 * 用法：router.post('/xxx', validate({body: JoiSchema}), controller)
 */
const Joi = require('joi');

const PAGINATION = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  pageSize: Joi.number().integer().min(1).max(500).default(20),
  keyword: Joi.string().allow('').max(80).optional()
});

const validate = (schemas, options = {}) => async (ctx, next) => {
  const merged = { ...schemas };
  if (schemas.paginate) {
    merged.query = (merged.query ? merged.query.concat(PAGINATION) : PAGINATION);
    delete merged.paginate;
  }
  ['params', 'query', 'body', 'headers'].forEach(k => {
    if (!merged[k]) return;
    const { value, error } = merged[k].validate(ctx.request?.[k] ?? ctx[k], {
      abortEarly: false,
      stripUnknown: options.stripUnknown === false ? false : true,
      allowUnknown: options.stripUnknown === false ? true : false,
      convert: true
    });
    if (error) throw error;
    if (k === 'query') ctx.query = value;
    else if (k === 'params') ctx.params = value;
    else if (k === 'body') ctx.request.body = value;
    else if (k === 'headers') ctx.request.headers = { ...ctx.request.headers, ...value };
  });
  return next();
};

module.exports = { validate, Joi, PAGINATION };
