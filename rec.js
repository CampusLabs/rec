(function () {
  'use strict';

  // Store a local reference to jQuery and Underscorea.
  var $ = window.jQuery;
  var _ = window._;

  var keyDirMap = {'38': 'prev', '40': 'next'};
  var ctrlKeyDirMap = {'80': 'prev', '78': 'next'};

  // Delay a callback `n` ms or invoke immediately if 0.
  var delay = function (cb, n) { return !n ? cb() : _.delay(cb, n); };

  // Direct event bindings to `$el`.
  var directEvents = {
    mouseover: function () { this._hover = true; },
    mouseout: function () {
      this._hover = false;
      _.defer(_.bind(function () {
        if (!this._focus && !this._hover) this.hide();
      }, this));
    }
  };

  // Delegated event bindings to children of `$el`.
  var delegatedEvents = {
    '.js-rec-input': {
      focus: function (ev) {
        this._focus = true;
        this.query($(ev.currentTarget).val()).show();
      },
      keydown: function (ev) {
        var key = ev.which;
        var dir = keyDirMap[key] || (ev.ctrlKey && ctrlKeyDirMap[key]);
        if (dir) {
          ev.preventDefault();
          return this[dir]();
        }
        if (key === 13) {
          var $selected = this.$el.find('.js-rec-selected');
          if ($selected.length) {
            $selected.click();
            $selected[0].click();
            return ev.preventDefault();
          }
        }
        var $input = $(ev.currentTarget);
        _.defer(_.bind(function () { this.query($input.val()); }, this));
      },
      blur: function () {
        this._focus = false;
        if (!this._hover) this.hide();
      }
    },
    '.js-rec-result': {
      mouseover: function (ev) { this.select($(ev.currentTarget)); },
      click: function () {
        this.$el.find('.js-rec-input').blur();
        this.hide();
      }
    }
  };


  // Create the `Rec` constructor.
  //
  // ```js
  // var rec = new Rec('#my-rec-container', {
  //   url: '/search',
  //   template: jst['search-result']
  // });
  // ```
  var Rec = window.Rec = function (el, options) {

    // Define a direct and delegated event hash unique to this instance.
    this._directEvents = {};
    _.each(directEvents, function (cb, key) {
      this._directEvents[key] = _.bind(cb, this);
    }, this);
    this._delegatedEvents = {};
    _.each(delegatedEvents, function (evs, selector) {
      var bound = this._delegatedEvents[selector] = {};
      _.each(evs, function (cb, name) {
        bound[name] = _.bind(cb, this);
      }, this);
    }, this);

    // Create a cache object to store results.
    this._cached = {};

    // Track concurrent fetches for showing/hiding the loading spinner.
    this._fetchQueue = 0;

    // Set the container element.
    this.setElement(el);

    // Extend the instance with its options.
    for (var name in options) this[name] = options[name];
  };

  // Define `prototype` properties and methods for `Olay`.
  var proto = {

    // How long since the last keystroke should rec wait to call `fetch`?
    delay: 250,

    // Should results be cached? Any cross-session caching will need to be
    // handled by your `fetch` method.
    cache: true,

    // The key to use for the query in the query string.
    queryKey: 'q',

    // Should the first result automatically be selected? In other words, will
    // hitting return fire the first recommended result or the broad result?
    selectFirst: true,

    // Parse the query before sending it to `fetch`. This allows you to clean up
    // bad characters, extra spaces, etc...
    parse: function (q) {
      return q.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '').toLowerCase();
    },

    query: function (q) {

      // Parse the raw query string.
      q = this.parse(q);

      // Compare to the last query and store so we don't waste any time.
      if (q === this._lastQ) return this;
      this._lastQ = q;

      // Clear the old `fetch` request if one was about to fire.
      if (this._timeout) {
        clearTimeout(this._timeout);
        this._timeout = null;
        if (!--this._fetchQueue) this.$el.removeClass('js-rec-loading');
      }

      // Looked for a cache result before trying to load.
      if (!this.getCached(q)) {

        // Add the loading class.
        ++this._fetchQueue;
        this.$el.addClass('js-rec-loading');

        // Start a timeout to `fetch`
        var self = this;
        this._timeout = delay(function () {
          self._timeout = null;
          self.fetch(q, function (er, results) {
            if (!--self._fetchQueue) self.$el.removeClass('js-rec-loading');
            if (!er) self.setCached(q, results);
            self._render();
          });
        }, this.delay);
      }
      return this._render();
    },

    // The default `fetch` sends `rec.url` a GET request with the URL parameter
    // `q` set to the value passed. You can override this method to use your own
    // retrieval method.
    fetch: function (q, cb) {
      var data = this.data || {};
      data[this.queryKey] = q;
      $.ajax({
        type: 'get',
        url: this.url,
        data: data,
        dataType: 'json',
        success: function (results) { cb(null, results); },
        error: function (xhr) { cb(xhr.responseText); }
      });
      return this;
    },

    // Set the input element the rec will watch.
    setElement: function (el) {
      if (this.$el) {
        this.$el.off(this._directEvents);
        this._unbind();
      }
      this.$el = (el instanceof $ ? el : $(el)).on(this._directEvents);
      this._bind();
      return this;
    },

    // Bind (or unbind) delegated events from a multi-level object.
    _bind: function (unbind) {
      var $el = this.$el;
      var method = unbind ? 'off': 'on';
      _.each(this._delegatedEvents, function (evs, selector) {
        _.each(evs, function (cb, name) { $el[method](name, selector, cb); });
      });
    },

    // Inverse `_bind`.
    _unbind: function () { this._bind('off'); },

    // Build the elements for the given query, only if they haven't been built
    // yet.
    _render: function () {
      var q = this._lastQ;
      var results = this.getCached(q) || this.getFiltered(q);
      this.$el.removeClass('js-rec-no-results');
      this.$el.find('.js-rec-result, .js-rec-label').remove();
      var $results = this.$el.find('.js-rec-results');
      if (!results) return this;
      if (_.size(results)) {
        _.each(results, function (results, label) {
          if (label !== 'undefined') $results.append(this._renderLabel(label));
          _.each(results, function (result) {
            $results.append(this._renderResult(result));
          }, this);
        }, this);
        this.select();
      } else {
        this.$el.addClass('js-rec-no-results');
      }
      return this;
    },

    _renderLabel: function (label) {
      return $('<div>').addClass('js-rec-label').text(label);
    },

    _renderResult: function (result) {
      return $(this.template(result))
        .addClass('js-rec-result')
        .data('recResult', result);
    },

    show: function () {
      this.$el.find('.js-rec-results');
      this.select();
      return this;
    },

    hide: function () {
      this.$el.find('.js-rec-results');
      return this;
    },

    select: function ($el) {
      this.$el.find('.js-rec-selected').removeClass('js-rec-selected');
      if (!$el && this.selectFirst) {
        $el = this.$el.find('.js-rec-result').first();
      }
      if ($el) $el.addClass('js-rec-selected');
      return this;
    },

    prev: function () {
      return this.select(
        this.$el.find('.js-rec-selected').prevAll('.js-rec-result').first()
      );
    },

    next: function () {
      var $selected = this.$el.find('.js-rec-selected');
      var $next = $selected.nextAll('.js-rec-result').first();
      if (!$selected.length) {
        $next = this.$el.find('.js-rec-result').first();
      } else if (!$next.length) {
        return this;
      }
      return this.select($next);
    },

    getCached: function (q) {
      return this.cache && this._cached[q];
    },

    setCached: function (q, results) {
      results = results instanceof Array ? results : [];
      this._cached[q] = _.groupBy(results, this.groupBy);
      return this;
    },

    getFiltered: function (q) {
      if (!this.filter) return null;
      var cached;
      for (var i = q.length - 1; i > 0; --i) {
        if (cached = this.getCached(q.slice(0, i))) break;
      }
      if (!cached) return null;
      var filter = _.bind(this.filter, this, q);
      var matches = _.reduce(cached, function (matches, results, label) {
        var filtered = _.filter(results, filter);
        if (filtered.length) matches[label] = filtered;
        return matches;
      }, {});
      return _.size(matches) ? matches : null;
    }
  };

  // Extend `Rec.prototype`.
  for (var name in proto) Rec.prototype[name] = proto[name];
})();
