
const TABLE = 'spaces';

module.exports = function (injectedStore) {
    let store = injectedStore;

    if (!store) {
        store = require('../../../../store/dummy');
    };

    async function list() {
        return await store.list(TABLE);
    };

    async function get(id) {
        return await store.get(TABLE, id);
    };

    async function insert(data) {
        const params = ['name', 'width', 'length', 'height', 'ciudad', 'volume'];
        return store.insert(TABLE, { data, params });
    }

    async function update(data) {
        return store.update(TABLE, data);
    }

    async function remove(id) {
        return store.remove(TABLE, id);
    }

    return {
        list,
        insert,
        update,
        remove,
        get
    };
}