docker build \
	--build-arg http_proxy=http://192.168.110.152:7890 \
	--build-arg https_proxy=http://192.168.110.152:7890 \
	--build-arg http_proxy=localhost,127.0.0.1,.example.com \
	-t openclaw:local \
	-f ./Dockerfile .
