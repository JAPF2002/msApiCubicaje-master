// src/api/store/remote.js
const axios = require('axios');

module.exports = function (host, port) {
  const baseURL = `http://${host}:${port}`;

  // función genérica para hacer peticiones HTTP al microservicio MySQL
  function request(method, route, data) {
    return axios({
      method,
      url: `${baseURL}/${route}`,
      data
    })
      .then(res => {
        // ✅ Desenvuelve el body del microservicio MySQL para evitar respuestas anidadas
        if (res && res.data && typeof res.data === 'object') {
          if ('body' in res.data) return res.data.body;
          return res.data;
        }
        return res.data;
      })
      .catch(err => {
        console.error('[remote.js] Error:', err.message);
        throw err;
      });
  }

  return {
    list:   (table)       => request('get',    table),
    get:    (table, id)   => request('get',    `${table}/${id}`),
    insert: (table, data) => request('post',   table, data),
    update: (table, data) => request('put',    table, data),
    remove: (table, id)   => request('delete', `${table}/${id}`)
  };
};
