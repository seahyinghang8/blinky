const uneval = require('un-eval');
const yaml = require('js-yaml');

module.exports = function (source) {
  const res = yaml.load(source);
  return `export default ${uneval(res)}`;
};
