/* Copyright (c) 2013 iSencia AB (http://www.isencia.se/)
 * Licensed under the MIT (LICENSE)
 *
 * Version: 0.1.1
 * Requires jQuery 1.3+
 * Docs: https://github.com/iSenciaSweden/eSengoCity-jquery
 */

(function($){

// default options
var o = {
    entryPoint: null,
    portal:     null,
    space:      null,
    node:       null,
    language:   null,
    timeout:    10,
    cache:      true
};

// true if we have internet connectivity
var connected = true;

// main api entry
$['eSengoCity'] = {

    // set options
    setOptions: function(options) {
        var opt = $.extend({}, o, options);
        o = opt;
    },
    
    // set internet connectivity
    setConnectivity: function(haveInternet) {
        connected = (haveInternet == true);
    },
    
    // list spaces
    listSpaces: function(options) {
        var opt = {
            fullFetch: true,
            requireNode: true
        };
        options = (options === undefined) ? $.extend({}, opt, o) : $.extend({}, o, opt, options);
        return new DataStore('listSpaces', options);
    },
    
    // list categories
    listCategories: function(options) {
        var opt = {
            requireNode: true,
            requireSpace: true
        };
        options = (options === undefined) ? $.extend({}, opt, o) : $.extend({}, o, opt, options);
        return new DataStore('listCategories', options);
    },
    
    // list promotions
    listPromotions: function(options) {
        var opt = {
            requireNode: true,
            requireSpace: true
        };
        options = (options === undefined) ? $.extend({}, opt, o) : $.extend({}, o, opt, options);
        return new DataStore('listPromotions', options);
    },
    
    // custom store
    customStore: function(command, options) {
        options = (options === undefined) ? $.extend({}, o) : $.extend({}, o, options);
        return new DataStore(command, options);
    }

};

// data store class
function DataStore(command, options) {

    // options
    var o = {
        pageSize:         8,
        fetchPages:       5,
        cacheTimeout:     20,
        useOldOnError:    true,
        fullFetch:        false,
        prefetch:         true,
        orderBy:          null,
        requireNode:      false,
        requirePortal:    false,
        requireLanguage:  false,
        requireSpace:     false
    };
    
    // remote data state
    var itemCount = 0;
    var pageCount = 0;

    // local data state
    var firstFetch = true;
    var pageFirst = 0;
    /* Pages are stores as objects
     *   items: array of items
     *   created: timestamp when the page was locally created
     */
    var pages = [];
    
    // request counter
    var requestNumber = 0;
    var expected = null;

    // status object
    var dfd_expected = null;

    // set options
    this.setOptions = function(options) {
        var opt = $.extend({}, o, options);
        // fix invalid values
        if (o.pageSize < 1) o.pageSize = 1;
        // detect things that require a reset of local data
        var reset = false;
        if (opt.pageSize != o.pageSize) {
            pageCount = Math.ceil(itemCount / opt.pageSize);
            reset = true;
        }
        if (opt.entryPoint != o.entryPoint) reset = true;
        if (opt.portal != o.portal) reset = true;
        if (opt.space != o.space) reset = true;
        if (opt.language != o.language) reset = true;
        if (opt.orderBy != o.orderBy) reset = true;
        if (opt.fullFetch != o.fullFetch) reset = true;
        // something has changed, reset local data
        if (reset) {
            firstFetch = true;
            pageFirst = 0;
            pages = [];
            if (expected) {
                expected = null;
                dfd_expected.reject('cancel', 'The request was canceled by a newer request.');
            }
        }
        o = opt;
    };
    
    // request a page(s) from the store
    this.getPage = function(pageId, pageCount) {
        var dfd = $.Deferred();
        pageId = (pageId === undefined) ? 0 : +pageId;
        pageCount = (pageCount === undefined) ? 1 : +pageCount;
        // check if we have the pages in cache
        if (this.isPageLoaded(pageId, pageCount)) {
            var id = pageId - pageFirst;
            var ret = {
                firstPage: pageId,
                pageCount: pageCount,
                pageSize: o.pageSize,
                itemCount: itemCount,
                items: pages[id].items
            };
            dfd.resolve(ret);
        }
        // fetch
        else {
            fetchData(dfd, pageId, pageCount); 
        }
        return dfd;
    };
    
    // get number of items
    this.getItemsCount = function() {
        return itemCount;
    };
    
    // get number of pages
    this.getPagesCount = function() {
        return pageCount;
    };
    
    // get page size
    this.getPageSize = function() {
        return o.pageSize;
    };
    
    // set page size
    this.setPageSize = function(pageSize) {
        this.setOptions({pageSize:pageSize});
    };
    
    // get number of loaded items (it may also include expired items)
    this.getLoadedItemsCount = function() {
        return (pages.length > 0) ? (pages.length - 1) * o.pageSize + pages[pages.length - 1].items.length : 0;
    };
    
    // get number of loaded pages
    this.getLoadedPagesCount = function() {
        return pages.length;
    };
    
    // clear local data
    this.clear = function() {
        firstFetch = true;
        pageFirst = 0;
        pages = [];
    };
    
    // check if page(s) is loaded
    this.isPageLoaded = function(pageId, pageCount, allowOld) {
        pageId = (pageId === undefined || pageId === null) ? 0 : +pageId;
        pageCount = (pageCount === undefined || pageCount === null) ? 1 : +pageCount;
        allowOld = (allowOld === undefined) ? false : allowOld;
        if (pageCount < 1) pageCount = 1;
        if (pageId >= pageFirst) {
            pageId -= pageFirst;
            if ((pageId + pageCount) <= pages.length) {
                var ret = true;
                // make sure all pages are fresh
                if (!allowOld) {
                    var current = +new Date;
                    for (var i = 0; i < pageCount; i++) {
                        if (current > (pages[pageId + i].created + o.cacheTimeout * 60000)) {
                            ret = false;
                            break;
                        }
                    }
                }
                return ret;
            }
        }
        return false;
    };
    
    // "constructor" stuff
    this.setOptions(options);
        
    // do a fetch
    function fetchData(dfd, startPage, maxPages) {
        if ((command === undefined || command === null || command == '' || o.entryPoint === null)
            || (o.requireNode && o.node === null)
            || (o.requirePortal && o.portal === null)
            || (o.requireSpace && o.space === null)
            || (o.requireLanguage && o.language === null)
        ) {
            dfd.reject('argument_missing', 'One or more required arguments are missing.');
            return;
        }
        startPage = (startPage === undefined || startPage === null) ? null : +startPage;
        maxPages = (maxPages === undefined || maxPages === null) ? null : +maxPages;
        var fullFetch = o.fullFetch;
        var pageSize = o.pageSize;
        // don't even try to fetch
        if (!connected) {
        }
        // build url
        var url = o.entryPoint + encodeURIComponent(command);
        var d = '?';
        if (o.node !== null) {
            url += d + 'node=' + encodeURIComponent(o.node);
            d = '&';
        }
        if (o.language !== null) {
            url += d + 'lang=' + encodeURIComponent(o.language);
            d = '&';
        }
        if (o.portal !== null) {
            url += d + 'portal=' + encodeURIComponent(o.portal);
            d = '&';
        }
        if (o.space !== null) {
            url += d + 'space=' + encodeURIComponent(o.space);
            d = '&';
        }
        // start and max pages arguments
        if (!fullFetch) {
            var realStartPage = startPage;
            var realMaxPages = maxPages;
            if ((realStartPage !== null) && (realMaxPages !== null)) {
                // special case for the first fetch
                if (firstFetch) {
                    if ((realStartPage + realMaxPages) <= o.fetchPages) {
                        realStartPage = 0;
                        realMaxPages = o.fetchPages;
                    }
                }
                // prefetch
                if (o.prefetch) {
                    // fetch one page before
                    if ((realStartPage > 0) && !this.isPageLoaded(realStartPage - 1)) {
                        realStartPage--;
                        realMaxPages++;
                    }
                    // fetch one extra page after
                    if (((realStartPage + realMaxPages) < pageCount) && !this.isPageLoaded(realStartPage + realMaxPages)) realMaxPages++;
                }
            }
            if (realStartPage !== null) {
                url += d + 'start=' + realStartPage * pageSize;
                d = '&';
            }
            if (realMaxPages !== null) {
                url += d + 'max=' + realMaxPages * pageSize;
                d = '&';
            }
        }
        // ajax fetch
        var id = requestNumber++;
        if (expected !== null) dfd_expected.reject('cancel', 'The request was canceled by a newer request.');
        dfd_expected = dfd;
        expected = id;
        $.ajax({
            url: url,
            cache: o.cache,
            timeout: o.timeout * 1000,
            dataType: 'json'
        }).done(function(data, textStatus, jqXHR){
            var items, total, fetched;
            // array of fetched items
            if ('elements' in data) items = data.elements;
            else items = [];
            // toal size of the remote store
            if ('size' in data) total = +data.size;
            else total = items.length;
            // number of pages returned
            var fetched = Math.ceil(items.length / pageSize);
            // we expected this data
            if (expected === id) {
                expected = null;
                if (fullFetch && total == items.length) {
                    pageFirst = 0;
                    pages = [{
                        items: items,
                        created: +new Date
                    }];
                    itemCount = items.length;
                    pageCount = 1;
                    o.pageSize = itemCount;
                    dfd.resolve({
                        firstPage: 0,
                        pageCount: pageCount,
                        pageSize: o.pageSize,
                        itemCount: itemCount,
                        items: pages[0].items
                    });
                }
                else {
                    // reset local data if remote size has changed
                    if (total != itemCount) {
                        itemCount = total;
                        pageCount = Math.ceil(total / pageSize);
                        pageFirst = 0;
                        pages = [];
                    }
                    firstFetch = false;
                    itemCount = total;
                    pageCount = Math.ceil(itemCount / o.pageSize);
                    var fetchedPages = Math.ceil(items.length / o.pageSize);
                }
            }
            // see if we can add it to the cache
            else if (!fullFetch && !o.fullFetch && total == itemCount) {
            }
        }).fail(function(jqXHR, textStatus, errorThrown){
            if (expected === id) {
                expected = null;
                // as a fallback, try to use cache to fetch some results
                if (o.useOldOnError && isPageLoaded(startPage, 1, true)) {
                    if (startPage === null) startPage = 0;
                    if (maxPages === null) maxPages = 1;
                    var ret = {
                        firstPage: startPage,
                        pageCount: pageCount,
                        pageSize: pageSize,
                        itemCount: itemCount,
                        items: []
                    };
                    startPage -= pageFirst;
                    for (var i = 0; i < maxPages; i++) {
                        if (i >= pages.length) break;
                        for (var j = 0; j < pages[i].items.length; j++) {
                            ret.items.push(pages[i].items[j]);
                        }
                    }
                    dfd.resolve(ret);
                }
                else dfd.reject('request_failed', 'AJAX request failed.');
            }
        });
    }
}

})(jQuery);
