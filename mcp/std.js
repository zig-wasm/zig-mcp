(function() {
    const CAT_namespace = 0;
    const CAT_container = 1;
    const CAT_global_variable = 2;
    const CAT_function = 3;
    const CAT_primitive = 4;
    const CAT_error_set = 5;
    const CAT_global_const = 6;
    const CAT_alias = 7;
    const CAT_type = 8;
    const CAT_type_type = 9;
    const CAT_type_function = 10;

    const LOG_err = 0;
    const LOG_warn = 1;
    const LOG_info = 2;
    const LOG_debug = 3;

    const domContent = document.getElementById("content");
    const domSearch = document.getElementById("search");
    const domErrors = document.getElementById("errors");
    const domErrorsText = document.getElementById("errorsText");

    var searchTimer = null;

    const curNav = {
      tag: 0,
      decl: null,
      path: null,
    };
    var curNavSearch = "";

    const moduleList = [];

    let wasm_promise = fetch("main.wasm");
    let sources_promise = fetch("sources.tar").then(function(response) {
      if (!response.ok) throw new Error("unable to download sources");
      return response.arrayBuffer();
    });
    var wasm_exports = null;

    const text_decoder = new TextDecoder();
    const text_encoder = new TextEncoder();

    WebAssembly.instantiateStreaming(wasm_promise, {
      js: {
        log: function(level, ptr, len) {
          const msg = decodeString(ptr, len);
          switch (level) {
            case LOG_err:
              console.error(msg);
              domErrorsText.textContent += msg + "\n";
              domErrors.classList.remove("hidden");
              break;
            case LOG_warn:
              console.warn(msg);
              break;
            case LOG_info:
              console.info(msg);
              break;
            case LOG_debug:
              console.debug(msg);
              break;
          }
        },
      },
    }).then(function(obj) {
      wasm_exports = obj.instance.exports;
      window.wasm = obj; // for debugging

      sources_promise.then(function(buffer) {
        const js_array = new Uint8Array(buffer);
        const ptr = wasm_exports.alloc(js_array.length);
        const wasm_array = new Uint8Array(wasm_exports.memory.buffer, ptr, js_array.length);
        wasm_array.set(js_array);
        wasm_exports.unpack(ptr, js_array.length);

        updateModuleList();

        window.addEventListener('popstate', onPopState, false);
        domSearch.addEventListener('keydown', onSearchKeyDown, false);
        domSearch.addEventListener('input', onSearchChange, false);
        window.addEventListener('keydown', onWindowKeyDown, false);
        onHashChange(null);
      });
    });

    function renderTitle() {
      const suffix = " - Zig Documentation";
      if (curNavSearch.length > 0) {
        document.title = curNavSearch + " - Search" + suffix;
      } else if (curNav.decl != null) {
        document.title = fullyQualifiedName(curNav.decl) + suffix;
      } else if (curNav.path != null) {
        document.title = curNav.path + suffix;
      } else {
        document.title = moduleList[0] + suffix;
      }
    }

    function render() {
        renderTitle();
        domContent.textContent = "";

        if (curNavSearch !== "") return renderSearch();

        switch (curNav.tag) {
          case 0: return renderHome();
          case 1:
            if (curNav.decl == null) {
              return renderNotFound();
            } else {
              return renderDecl(curNav.decl);
            }
          case 2: return renderSource(curNav.path);
          default: throw new Error("invalid navigation state");
        }
    }

    function renderHome() {
      if (moduleList.length == 0) {
        domContent.textContent = "# Error\n\nsources.tar contains no modules";
        return;
      }
      return renderModule(0);
    }

    function renderModule(pkg_index) {
      const root_decl = wasm_exports.find_module_root(pkg_index);
      return renderDecl(root_decl);
    }

    function renderDecl(decl_index) {
      const category = wasm_exports.categorize_decl(decl_index, 0);
      switch (category) {
        case CAT_namespace:
        case CAT_container:
          return renderNamespacePage(decl_index);
        case CAT_global_variable:
        case CAT_primitive:
        case CAT_global_const:
        case CAT_type:
        case CAT_type_type:
          return renderGlobal(decl_index);
        case CAT_function:
          return renderFunction(decl_index);
        case CAT_type_function:
          return renderTypeFunction(decl_index);
        case CAT_error_set:
          return renderErrorSetPage(decl_index);
        case CAT_alias:
          return renderDecl(wasm_exports.get_aliasee());
        default:
          throw new Error("unrecognized category " + category);
      }
    }

    function renderSource(path) {
      const decl_index = findFileRoot(path);
      if (decl_index == null) return renderNotFound();

      let markdown = "";
      markdown += "# " + path + "\n\n";
      markdown += unwrapString(wasm_exports.decl_source_html(decl_index));
      
      domContent.textContent = markdown;
    }

    function renderNamespacePage(decl_index) {
      let markdown = "";
      
      // Add navigation breadcrumb
      markdown += renderNavMarkdown(decl_index);
      
      // Add title
      const name = unwrapString(wasm_exports.decl_category_name(decl_index));
      markdown += "# " + name + "\n\n";
      
      // Add documentation
      const docs = unwrapString(wasm_exports.decl_docs_html(decl_index, false));
      if (docs.length > 0) {
        markdown += docs + "\n\n";
      }
      
      // Add namespace content
      const members = namespaceMembers(decl_index, false).slice();
      const fields = declFields(decl_index).slice();
      markdown += renderNamespaceMarkdown(decl_index, members, fields);
      
      domContent.textContent = markdown;
    }

    function renderFunction(decl_index) {
      let markdown = "";
      
      // Add navigation breadcrumb
      markdown += renderNavMarkdown(decl_index);
      
      // Add title
      const name = unwrapString(wasm_exports.decl_category_name(decl_index));
      markdown += "# " + name + "\n\n";
      
      // Add documentation
      const docs = unwrapString(wasm_exports.decl_docs_html(decl_index, false));
      if (docs.length > 0) {
        markdown += docs + "\n\n";
      }
      
      // Add function prototype
      const proto = unwrapString(wasm_exports.decl_fn_proto_html(decl_index, false));
      if (proto.length > 0) {
        markdown += "## Function Signature\n\n" + proto + "\n\n";
      }
      
      // Add parameters
      const params = declParams(decl_index).slice();
      if (params.length > 0) {
        markdown += "## Parameters\n\n";
        for (let i = 0; i < params.length; i++) {
          const param_html = unwrapString(wasm_exports.decl_param_html(decl_index, params[i]));
          markdown += param_html + "\n\n";
        }
      }
      
      // Add errors
      const errorSetNode = fnErrorSet(decl_index);
      if (errorSetNode != null) {
        const base_decl = wasm_exports.fn_error_set_decl(decl_index, errorSetNode);
        const errorList = errorSetNodeList(decl_index, errorSetNode);
        if (errorList != null && errorList.length > 0) {
          markdown += "## Errors\n\n";
          for (let i = 0; i < errorList.length; i++) {
            const error_html = unwrapString(wasm_exports.error_html(base_decl, errorList[i]));
            markdown += error_html + "\n\n";
          }
        }
      }
      
      // Add doctest
      const doctest = unwrapString(wasm_exports.decl_doctest_html(decl_index));
      if (doctest.length > 0) {
        markdown += "## Example Usage\n\n" + doctest + "\n\n";
      }
      
      // Add source code
      const source = unwrapString(wasm_exports.decl_source_html(decl_index));
      if (source.length > 0) {
        markdown += "## Source Code\n\n" + source + "\n\n";
      }
      
      domContent.textContent = markdown;
    }

    function renderGlobal(decl_index) {
      let markdown = "";
      
      // Add navigation breadcrumb
      markdown += renderNavMarkdown(decl_index);
      
      // Add title
      const name = unwrapString(wasm_exports.decl_category_name(decl_index));
      markdown += "# " + name + "\n\n";
      
      // Add documentation
      const docs = unwrapString(wasm_exports.decl_docs_html(decl_index, true));
      if (docs.length > 0) {
        markdown += docs + "\n\n";
      }
      
      // Add source code
      const source = unwrapString(wasm_exports.decl_source_html(decl_index));
      if (source.length > 0) {
        markdown += "## Source Code\n\n" + source + "\n\n";
      }
      
      domContent.textContent = markdown;
    }

    function renderTypeFunction(decl_index) {
      let markdown = "";
      
      // Add navigation breadcrumb
      markdown += renderNavMarkdown(decl_index);
      
      // Add title
      const name = unwrapString(wasm_exports.decl_category_name(decl_index));
      markdown += "# " + name + "\n\n";
      
      // Add documentation
      const docs = unwrapString(wasm_exports.decl_docs_html(decl_index, false));
      if (docs.length > 0) {
        markdown += docs + "\n\n";
      }
      
      // Add parameters
      const params = declParams(decl_index).slice();
      if (params.length > 0) {
        markdown += "## Parameters\n\n";
        for (let i = 0; i < params.length; i++) {
          const param_html = unwrapString(wasm_exports.decl_param_html(decl_index, params[i]));
          markdown += param_html + "\n\n";
        }
      }
      
      // Add doctest
      const doctest = unwrapString(wasm_exports.decl_doctest_html(decl_index));
      if (doctest.length > 0) {
        markdown += "## Example Usage\n\n" + doctest + "\n\n";
      }
      
      // Add namespace content or source
      const members = unwrapSlice32(wasm_exports.type_fn_members(decl_index, false)).slice();
      const fields = unwrapSlice32(wasm_exports.type_fn_fields(decl_index)).slice();
      if (members.length !== 0 || fields.length !== 0) {
        markdown += renderNamespaceMarkdown(decl_index, members, fields);
      } else {
        const source = unwrapString(wasm_exports.decl_source_html(decl_index));
        if (source.length > 0) {
          markdown += "## Source Code\n\n" + source + "\n\n";
        }
      }
      
      domContent.textContent = markdown;
    }

    function renderErrorSetPage(decl_index) {
      let markdown = "";
      
      // Add navigation breadcrumb
      markdown += renderNavMarkdown(decl_index);
      
      // Add title
      const name = unwrapString(wasm_exports.decl_category_name(decl_index));
      markdown += "# " + name + "\n\n";
      
      // Add documentation
      const docs = unwrapString(wasm_exports.decl_docs_html(decl_index, false));
      if (docs.length > 0) {
        markdown += docs + "\n\n";
      }
      
      // Add errors
      const errorSetList = declErrorSet(decl_index).slice();
      if (errorSetList != null && errorSetList.length > 0) {
        markdown += "## Errors\n\n";
        for (let i = 0; i < errorSetList.length; i++) {
          const error_html = unwrapString(wasm_exports.error_html(decl_index, errorSetList[i]));
          markdown += error_html + "\n\n";
        }
      }
      
      domContent.textContent = markdown;
    }

    function renderNavMarkdown(decl_index) {
      let markdown = "";
      const list = [];
      
      // Walk backwards through decl parents
      let decl_it = decl_index;
      while (decl_it != null) {
        list.push(declIndexName(decl_it));
        decl_it = declParent(decl_it);
      }
      
      // Walk backwards through file path segments
      if (decl_index != null) {
        const file_path = fullyQualifiedName(decl_index);
        const parts = file_path.split(".");
        parts.pop(); // skip last
        for (let i = parts.length - 1; i >= 0; i--) {
          if (parts[i]) {
            list.push(parts[i]);
          }
        }
      }
      
      list.reverse();
      
      if (list.length > 0) {
        markdown += "*Navigation: " + list.join(" > ") + "*\n\n";
      }
      
      return markdown;
    }

    function renderNamespaceMarkdown(base_decl, members, fields) {
      let markdown = "";
      
      const typesList = [];
      const namespacesList = [];
      const errSetsList = [];
      const fnsList = [];
      const varsList = [];
      const valsList = [];

      // Categorize members
      for (let i = 0; i < members.length; i++) {
        let member = members[i];
        const original = member;
        while (true) {
          const member_category = wasm_exports.categorize_decl(member, 0);
          switch (member_category) {
            case CAT_namespace:
              namespacesList.push({original: original, member: member});
              break;
            case CAT_container:
              typesList.push({original: original, member: member});
              break;
            case CAT_global_variable:
              varsList.push(member);
              break;
            case CAT_function:
              fnsList.push(member);
              break;
            case CAT_type:
            case CAT_type_type:
            case CAT_type_function:
              typesList.push({original: original, member: member});
              break;
            case CAT_error_set:
              errSetsList.push({original: original, member: member});
              break;
            case CAT_global_const:
            case CAT_primitive:
              valsList.push({original: original, member: member});
              break;
            case CAT_alias:
              member = wasm_exports.get_aliasee();
              continue;
            default:
              throw new Error("unknown category: " + member_category);
          }
          break;
        }
      }

      // Render each category
      if (typesList.length > 0) {
        markdown += "## Types\n\n";
        for (let i = 0; i < typesList.length; i++) {
          const name = declIndexName(typesList[i].original);
          markdown += "- " + name + "\n";
        }
        markdown += "\n";
      }

      if (namespacesList.length > 0) {
        markdown += "## Namespaces\n\n";
        for (let i = 0; i < namespacesList.length; i++) {
          const name = declIndexName(namespacesList[i].original);
          markdown += "- " + name + "\n";
        }
        markdown += "\n";
      }

      if (errSetsList.length > 0) {
        markdown += "## Error Sets\n\n";
        for (let i = 0; i < errSetsList.length; i++) {
          const name = declIndexName(errSetsList[i].original);
          markdown += "- " + name + "\n";
        }
        markdown += "\n";
      }

      if (fnsList.length > 0) {
        markdown += "## Functions\n\n";
        for (let i = 0; i < fnsList.length; i++) {
          const decl = fnsList[i];
          const name = declIndexName(decl);
          const proto = unwrapString(wasm_exports.decl_fn_proto_html(decl, true));
          const docs = unwrapString(wasm_exports.decl_docs_html(decl, true));
          
          markdown += "### " + name + "\n\n";
          if (proto.length > 0) {
            markdown += proto + "\n\n";
          }
          if (docs.length > 0) {
            markdown += docs + "\n\n";
          }
        }
      }

      if (fields.length > 0) {
        markdown += "## Fields\n\n";
        for (let i = 0; i < fields.length; i++) {
          const field_html = unwrapString(wasm_exports.decl_field_html(base_decl, fields[i]));
          markdown += field_html + "\n\n";
        }
      }

      if (varsList.length > 0) {
        markdown += "## Global Variables\n\n";
        for (let i = 0; i < varsList.length; i++) {
          const decl = varsList[i];
          const name = declIndexName(decl);
          const type_html = unwrapString(wasm_exports.decl_type_html(decl));
          const docs = unwrapString(wasm_exports.decl_docs_html(decl, true));
          
          markdown += "### " + name + "\n\n";
          if (type_html.length > 0) {
            markdown += "Type: " + type_html + "\n\n";
          }
          if (docs.length > 0) {
            markdown += docs + "\n\n";
          }
        }
      }

      if (valsList.length > 0) {
        markdown += "## Values\n\n";
        for (let i = 0; i < valsList.length; i++) {
          const original_decl = valsList[i].original;
          const decl = valsList[i].member;
          const name = declIndexName(original_decl);
          const type_html = unwrapString(wasm_exports.decl_type_html(decl));
          const docs = unwrapString(wasm_exports.decl_docs_html(decl, true));
          
          markdown += "### " + name + "\n\n";
          if (type_html.length > 0) {
            markdown += "Type: " + type_html + "\n\n";
          }
          if (docs.length > 0) {
            markdown += docs + "\n\n";
          }
        }
      }

      return markdown;
    }

    function renderNotFound() {
      domContent.textContent = "# Error\n\nDeclaration not found.";
    }

    function renderSearch() {
      const ignoreCase = (curNavSearch.toLowerCase() === curNavSearch);
      const results = executeQuery(curNavSearch, ignoreCase);

      let markdown = "# Search Results\n\n";
      markdown += "Query: \"" + curNavSearch + "\"\n\n";

      if (results.length > 0) {
        markdown += "Found " + results.length + " results:\n\n";
        for (let i = 0; i < results.length; i++) {
          const match = results[i];
          const full_name = fullyQualifiedName(match);
          markdown += "- " + full_name + "\n";
        }
      } else {
        markdown += "No results found.\n\nPress escape to exit search.";
      }

      domContent.textContent = markdown;
    }

    // Event handlers and utility functions (unchanged from original)
    function updateCurNav(location_hash) {
        curNav.tag = 0;
        curNav.decl = null;
        curNav.path = null;
        curNavSearch = "";

        if (location_hash.length > 1 && location_hash[0] === '#') {
            const query = location_hash.substring(1);
            const qpos = query.indexOf("?");
            let nonSearchPart;
            if (qpos === -1) {
                nonSearchPart = query;
            } else {
                nonSearchPart = query.substring(0, qpos);
                curNavSearch = decodeURIComponent(query.substring(qpos + 1));
            }

            if (nonSearchPart.length > 0) {
              const source_mode = nonSearchPart.startsWith("src/");
              if (source_mode) {
                curNav.tag = 2;
                curNav.path = nonSearchPart.substring(4);
              } else {
                curNav.tag = 1;
                curNav.decl = findDecl(nonSearchPart);
              }
            }
        }
    }

    function onHashChange(state) {
      history.replaceState({}, "");
      navigate(location.hash);
      if (state == null) window.scrollTo({top: 0});
    }

    function onPopState(ev) {
      onHashChange(ev.state);
    }

    function navigate(location_hash) {
      updateCurNav(location_hash);
      if (domSearch.value !== curNavSearch) {
          domSearch.value = curNavSearch;
      }
      render();
    }

    function onSearchKeyDown(ev) {
      switch (ev.code) {
        case "Enter":
          if (ev.shiftKey || ev.ctrlKey || ev.altKey) return;
          clearAsyncSearch();
          location.hash = computeSearchHash();
          ev.preventDefault();
          ev.stopPropagation();
          return;
        case "Escape":
          if (ev.shiftKey || ev.ctrlKey || ev.altKey) return;
          domSearch.value = "";
          domSearch.blur();
          ev.preventDefault();
          ev.stopPropagation();
          startSearch();
          return;
        default:
          ev.stopPropagation();
          return;
      }
    }

    function onSearchChange(ev) {
      startAsyncSearch();
    }

    function onWindowKeyDown(ev) {
      switch (ev.code) {
        case "KeyS":
          if (ev.shiftKey || ev.ctrlKey || ev.altKey) return;
          domSearch.focus();
          domSearch.select();
          ev.preventDefault();
          ev.stopPropagation();
          startAsyncSearch();
          break;
      }
    }

    function clearAsyncSearch() {
      if (searchTimer != null) {
        clearTimeout(searchTimer);
        searchTimer = null;
      }
    }

    function startAsyncSearch() {
      clearAsyncSearch();
      searchTimer = setTimeout(startSearch, 10);
    }

    function computeSearchHash() {
      const oldWatHash = location.hash;
      const oldHash = oldWatHash.startsWith("#") ? oldWatHash : "#" + oldWatHash;
      const parts = oldHash.split("?");
      const newPart2 = (domSearch.value === "") ? "" : ("?" + domSearch.value);
      return parts[0] + newPart2;
    }

    function startSearch() {
      clearAsyncSearch();
      navigate(computeSearchHash());
    }

    function updateModuleList() {
      moduleList.length = 0;
      for (let i = 0;; i += 1) {
        const name = unwrapString(wasm_exports.module_name(i));
        if (name.length == 0) break;
        moduleList.push(name);
      }
    }

    // Utility functions (unchanged from original)
    function decodeString(ptr, len) {
      if (len === 0) return "";
      return text_decoder.decode(new Uint8Array(wasm_exports.memory.buffer, ptr, len));
    }

    function unwrapString(bigint) {
      const ptr = Number(bigint & 0xffffffffn);
      const len = Number(bigint >> 32n);
      return decodeString(ptr, len);
    }

    function fullyQualifiedName(decl_index) {
      return unwrapString(wasm_exports.decl_fqn(decl_index));
    }

    function declIndexName(decl_index) {
      return unwrapString(wasm_exports.decl_name(decl_index));
    }

    function setQueryString(s) {
      const jsArray = text_encoder.encode(s);
      const len = jsArray.length;
      const ptr = wasm_exports.query_begin(len);
      const wasmArray = new Uint8Array(wasm_exports.memory.buffer, ptr, len);
      wasmArray.set(jsArray);
    }

    function executeQuery(query_string, ignore_case) {
      setQueryString(query_string);
      const ptr = wasm_exports.query_exec(ignore_case);
      const head = new Uint32Array(wasm_exports.memory.buffer, ptr, 1);
      const len = head[0];
      return new Uint32Array(wasm_exports.memory.buffer, ptr + 4, len);
    }

    function namespaceMembers(decl_index, include_private) {
      return unwrapSlice32(wasm_exports.namespace_members(decl_index, include_private));
    }

    function declFields(decl_index) {
      return unwrapSlice32(wasm_exports.decl_fields(decl_index));
    }

    function declParams(decl_index) {
      return unwrapSlice32(wasm_exports.decl_params(decl_index));
    }

    function declErrorSet(decl_index) {
      return unwrapSlice64(wasm_exports.decl_error_set(decl_index));
    }

    function errorSetNodeList(base_decl, err_set_node) {
      return unwrapSlice64(wasm_exports.error_set_node_list(base_decl, err_set_node));
    }

    function unwrapSlice32(bigint) {
      const ptr = Number(bigint & 0xffffffffn);
      const len = Number(bigint >> 32n);
      if (len === 0) return [];
      return new Uint32Array(wasm_exports.memory.buffer, ptr, len);
    }

    function unwrapSlice64(bigint) {
      const ptr = Number(bigint & 0xffffffffn);
      const len = Number(bigint >> 32n);
      if (len === 0) return [];
      return new BigUint64Array(wasm_exports.memory.buffer, ptr, len);
    }

    function findDecl(fqn) {
      setInputString(fqn);
      const result = wasm_exports.find_decl();
      if (result === -1) return null;
      return result;
    }

    function findFileRoot(path) {
      setInputString(path);
      const result = wasm_exports.find_file_root();
      if (result === -1) return null;
      return result;
    }

    function declParent(decl_index) {
      const result = wasm_exports.decl_parent(decl_index);
      if (result === -1) return null;
      return result;
    }

    function fnErrorSet(decl_index) {
      const result = wasm_exports.fn_error_set(decl_index);
      if (result === 0) return null;
      return result;
    }

    function setInputString(s) {
      const jsArray = text_encoder.encode(s);
      const len = jsArray.length;
      const ptr = wasm_exports.set_input_string(len);
      const wasmArray = new Uint8Array(wasm_exports.memory.buffer, ptr, len);
      wasmArray.set(jsArray);
    }
})();